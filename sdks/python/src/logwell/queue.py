"""Batch queue for the Logwell Python SDK.

This module provides the BatchQueue class for buffering logs and managing
automatic flush operations based on batch size and time interval.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from logwell.errors import LogwellError, LogwellErrorCode
from logwell.types import IngestResponse, LogEntry

if TYPE_CHECKING:
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
        self._queue: list[LogEntry] = []
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._flushing = False
        self._stopped = False

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
        with self._lock:
            if self._stopped:
                return

            # Handle queue overflow
            if len(self._queue) >= self._config.max_queue_size:
                dropped = self._queue.pop(0)
                if self._config.on_error:
                    msg = dropped.get("message", "")[:50]
                    self._config.on_error(
                        LogwellError(
                            f"Queue overflow: max_queue_size "
                            f"({self._config.max_queue_size}) exceeded. "
                            f"Dropped oldest log: '{msg}...'. "
                            "Logs are being generated faster than they can be sent. "
                            "Consider increasing max_queue_size, reducing log volume, "
                            "or calling flush() more frequently.",
                            LogwellErrorCode.QUEUE_OVERFLOW,
                        )
                    )

            self._queue.append(entry)

            # Start timer on first entry
            if self._timer is None and not self._stopped:
                self._start_timer()

            # Flush immediately if batch size reached
            should_flush = len(self._queue) >= self._config.batch_size

        if should_flush:
            self._trigger_flush()

    def _trigger_flush(self) -> None:
        """Trigger an asynchronous flush operation.

        This method schedules the flush to run in the background
        without blocking the caller.
        """
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.flush())
        except RuntimeError:
            # No running event loop, run in new loop
            asyncio.run(self.flush())

    async def flush(self) -> IngestResponse | None:
        """Flush all queued logs immediately.

        Returns:
            Response from the server, or None if queue was empty or flush in progress
        """
        with self._lock:
            # Prevent concurrent flushes
            if self._flushing or len(self._queue) == 0:
                return None

            self._flushing = True
            self._stop_timer()

            # Take current batch
            batch = self._queue.copy()
            self._queue.clear()
            count = len(batch)

        try:
            response = await self._send_batch(batch)
            if self._config.on_flush:
                self._config.on_flush(count)

            # Restart timer if more logs remain (added during flush)
            with self._lock:
                if len(self._queue) > 0 and not self._stopped:
                    self._start_timer()

            return response
        except Exception as error:
            # Re-queue failed logs at the front
            with self._lock:
                self._queue = batch + self._queue
                if self._config.on_error:
                    self._config.on_error(error)

                # Restart timer to retry
                if not self._stopped:
                    self._start_timer()

            return None
        finally:
            with self._lock:
                self._flushing = False

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

    def _start_timer(self) -> None:
        """Start the flush timer.

        Note: Must be called while holding the lock.
        """
        self._stop_timer()
        self._timer = threading.Timer(
            self._config.flush_interval,
            self._on_timer_expired,
        )
        self._timer.daemon = True
        self._timer.start()

    def _stop_timer(self) -> None:
        """Stop the flush timer.

        Note: Must be called while holding the lock.
        """
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _on_timer_expired(self) -> None:
        """Handle timer expiration by triggering a flush."""
        with self._lock:
            self._timer = None
            if self._stopped:
                return

        self._trigger_flush()
