"""Batch queue for the Logwell Python SDK.

This module provides the BatchQueue class for buffering logs and managing
automatic flush operations based on batch size and time interval.
"""

from __future__ import annotations

import asyncio
import threading
from collections import deque
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from logwell.errors import LogwellError, LogwellErrorCode
from logwell.types import IngestResponse, LogEntry

if TYPE_CHECKING:
    from concurrent.futures import Future as ConcurrentFuture
    from typing import Any

    from logwell.types import LogwellConfig

# Type alias for the send batch callback
SendBatchFn = Callable[[list[LogEntry]], Awaitable[IngestResponse]]


class QueueConfig:
    """Configuration for the batch queue.

    Attributes:
        batch_size: Number of logs to batch before auto-flush
        flush_interval: Seconds between auto-flushes
        max_queue_size: Maximum queue size before dropping oldest
        on_error: Callback function for errors
        on_flush: Callback function after successful flush
    """

    def __init__(
        self,
        batch_size: int = 50,
        flush_interval: float = 5.0,
        max_queue_size: int = 1000,
        on_error: Callable[[Exception], None] | None = None,
        on_flush: Callable[[int], None] | None = None,
    ) -> None:
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.max_queue_size = max_queue_size
        self.on_error = on_error
        self.on_flush = on_flush

    @classmethod
    def from_logwell_config(cls, config: LogwellConfig) -> QueueConfig:
        """Create QueueConfig from LogwellConfig."""
        return cls(
            batch_size=config.get("batch_size", 50),
            flush_interval=config.get("flush_interval", 5.0),
            max_queue_size=config.get("max_queue_size", 1000),
            on_error=config.get("on_error"),
            on_flush=config.get("on_flush"),
        )


class BatchQueue:
    """Batch queue for buffering and sending logs.

    Features:
    - Automatic flush on batch size threshold
    - Automatic flush on time interval
    - Queue overflow protection (drops oldest)
    - Re-queue on send failure
    - Graceful shutdown
    """

    def __init__(
        self,
        send_batch: SendBatchFn,
        config: QueueConfig | LogwellConfig,
    ) -> None:
        """Initialize the batch queue.

        Args:
            send_batch: Async callback function to send a batch of logs
            config: Either a QueueConfig or LogwellConfig
        """
        if isinstance(config, QueueConfig):
            self._config = config
        else:
            self._config = QueueConfig.from_logwell_config(config)

        self._send_batch = send_batch
        self._queue: deque[LogEntry] = deque()
        self._lock = threading.Lock()
        self._loop_lock = threading.Lock()  # Separate lock for event-loop creation (PY-3)
        self._timer_future: ConcurrentFuture[Any] | None = None
        self._flushing = False
        self._stopped = False
        self._queue_loop: asyncio.AbstractEventLoop | None = None
        self._queue_thread: threading.Thread | None = None

    @property
    def size(self) -> int:
        """Current number of logs in the queue."""
        with self._lock:
            return len(self._queue)

    def add(self, entry: LogEntry) -> None:
        """Add a log entry to the queue.

        Triggers flush if batch size is reached.
        Drops oldest log if queue overflows.

        Args:
            entry: Log entry to add
        """
        overflow_error: LogwellError | None = None
        with self._lock:
            if self._stopped:
                return

            # Handle queue overflow
            if len(self._queue) >= self._config.max_queue_size:
                dropped = self._queue.popleft()
                msg = dropped.get("message", "")[:50]
                overflow_error = LogwellError(
                    f"Queue overflow: max_queue_size "
                    f"({self._config.max_queue_size}) exceeded. "
                    f"Dropped oldest log: '{msg}...'. "
                    "Logs are being generated faster than they can be sent. "
                    "Consider increasing max_queue_size, reducing log volume, "
                    "or calling flush() more frequently.",
                    LogwellErrorCode.QUEUE_OVERFLOW,
                )

            self._queue.append(entry)

            # Start timer on first entry
            timer_future = getattr(self, "_timer_future", None)
            if (timer_future is None or timer_future.done()) and not self._stopped:
                self._start_timer()

            # Flush immediately if batch size reached
            should_flush = len(self._queue) >= self._config.batch_size

        # Invoke callback outside the lock to prevent re-entrant deadlock (PY-1)
        if overflow_error is not None and self._config.on_error:
            self._config.on_error(overflow_error)

        if should_flush:
            self._trigger_flush()

    def _trigger_flush(self) -> None:
        """Trigger an asynchronous flush operation.

        This method schedules the flush to run in the background
        without blocking the caller.
        """
        loop = self._ensure_loop()
        asyncio.run_coroutine_threadsafe(self._do_flush(), loop)

    async def flush(self) -> IngestResponse | None:
        """Flush all queued logs immediately.

        Returns:
            Response from the server, or None if queue was empty or flush in progress
        """
        if threading.current_thread() is self._queue_thread:
            return await self._do_flush()

        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(self._do_flush(), loop)
        try:
            asyncio.get_running_loop()
            return await asyncio.wrap_future(future)
        except RuntimeError:
            return future.result()

    async def _do_flush(self) -> IngestResponse | None:
        """Internal flush implementation."""
        with self._lock:
            # Prevent concurrent flushes
            if self._flushing or len(self._queue) == 0:
                return None

            self._flushing = True
            self._stop_timer()

            # Take current batch
            batch = list(self._queue)
            self._queue.clear()
            count = len(batch)

        send_error: Exception | None = None
        try:
            response = await self._send_batch(batch)
        except Exception as error:
            send_error = error
            response = None

        if send_error is not None:
            # Re-queue failed logs at the front (outside error callback to avoid deadlock)
            with self._lock:
                self._queue.extendleft(reversed(batch))

                # Restart timer to retry
                if not self._stopped:
                    self._start_timer()

            # Invoke callback outside the lock (PY-1)
            if self._config.on_error:
                self._config.on_error(send_error)

            with self._lock:
                self._flushing = False
            return None

        # Success path — call on_flush in its own try/except (PY-2)
        if self._config.on_flush:
            try:
                self._config.on_flush(count)
            except Exception as flush_err:
                if self._config.on_error:
                    self._config.on_error(flush_err)

        # Restart timer if more logs remain (added during flush)
        with self._lock:
            self._flushing = False
            if len(self._queue) > 0 and not self._stopped:
                self._start_timer()

        return response

    async def shutdown(self) -> None:
        """Flush remaining logs and stop the queue.

        This method is idempotent - safe to call multiple times.
        After shutdown, no more logs will be accepted.
        """
        with self._lock:
            if self._stopped:
                return

            self._stopped = True
            self._stop_timer()
            self._flushing = False  # Reset flushing flag

        # Flush all remaining logs
        if self.size > 0:
            await self.flush()

        self._stop_loop()

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        """Ensure a background event loop is running (double-checked locking, PY-3).

        Uses a dedicated _loop_lock separate from _lock so this method can be
        called safely from within code that already holds _lock.
        """
        loop = self._queue_loop
        if loop is not None and not loop.is_closed():
            return loop
        with self._loop_lock:
            loop = self._queue_loop
            if loop is None or loop.is_closed():
                loop = asyncio.new_event_loop()
                # Assign before starting the thread so _run_loop sees it
                self._queue_loop = loop
                thread = threading.Thread(target=self._run_loop, daemon=True)
                thread.start()
                self._queue_thread = thread
        return self._queue_loop  # type: ignore[return-value]

    def _run_loop(self) -> None:
        """Run the background event loop."""
        assert self._queue_loop is not None
        asyncio.set_event_loop(self._queue_loop)
        self._queue_loop.run_forever()

    def _stop_loop(self) -> None:
        """Stop the background event loop and thread."""
        if self._queue_loop is None or self._queue_thread is None:
            return

        if self._queue_loop.is_running() and not self._queue_loop.is_closed():
            self._queue_loop.call_soon_threadsafe(self._queue_loop.stop)

        if threading.current_thread() is not self._queue_thread:
            self._queue_thread.join(timeout=5.0)

        self._queue_loop = None
        self._queue_thread = None

    def _start_timer(self) -> None:
        """Start the flush timer.

        Note: Must be called while holding the lock.
        """
        self._stop_timer()
        loop = self._ensure_loop()
        self._timer_future = asyncio.run_coroutine_threadsafe(self._timer_coro(), loop)

    def _stop_timer(self) -> None:
        """Stop the flush timer.

        Note: Must be called while holding the lock.
        """
        future = getattr(self, "_timer_future", None)
        if future is not None:
            if not future.done():
                future.cancel()
            self._timer_future = None

    async def _timer_coro(self) -> None:
        """Handle timer expiration by triggering a flush."""
        my_future = getattr(self, "_timer_future", None)
        try:
            await asyncio.sleep(self._config.flush_interval)
            with self._lock:
                if self._stopped:
                    return
            self._trigger_flush()
        except asyncio.CancelledError:
            pass
        finally:
            if getattr(self, "_timer_future", None) is my_future:
                self._timer_future = None
