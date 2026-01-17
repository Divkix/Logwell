"""Unit tests for queue.py - BatchQueue class.

Tests cover:
- QueueConfig: construction and from_logwell_config
- BatchQueue: add, flush, size, shutdown methods
- Auto-flush on batch_size threshold
- Timer-based flush after flush_interval
- Queue overflow handling (drop oldest, call on_error)
- Concurrent add/flush operations (thread safety)
- Graceful shutdown behavior
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import TYPE_CHECKING, Any
from unittest.mock import MagicMock

import pytest

from logwell.errors import LogwellError, LogwellErrorCode
from logwell.queue import BatchQueue, QueueConfig

if TYPE_CHECKING:
    from logwell.types import IngestResponse, LogEntry


# =============================================================================
# Test Helpers
# =============================================================================


def make_log_entry(message: str = "test", level: str = "info") -> LogEntry:
    """Create a simple log entry for testing."""
    return {"level": level, "message": message}  # type: ignore[typeddict-item]


def make_send_batch_mock(
    response: IngestResponse | None = None,
    error: Exception | None = None,
) -> tuple[MagicMock, list[list[LogEntry]]]:
    """Create a mock send_batch function that tracks calls.

    Args:
        response: The response to return (default: {"accepted": 1})
        error: Exception to raise instead of returning response

    Returns:
        Tuple of (mock_function, captured_batches_list)
    """
    captured: list[list[LogEntry]] = []
    if response is None:
        response = {"accepted": 1}

    async def mock_send(batch: list[LogEntry]) -> IngestResponse:
        captured.append(batch)
        if error:
            raise error
        return response  # type: ignore[return-value]

    mock = MagicMock(side_effect=mock_send)
    return mock, captured


# =============================================================================
# QueueConfig Tests
# =============================================================================


class TestQueueConfigConstruction:
    """Tests for QueueConfig construction."""

    def test_default_values(self) -> None:
        """QueueConfig has sensible defaults."""
        config = QueueConfig()
        assert config.batch_size == 50
        assert config.flush_interval == 5.0
        assert config.max_queue_size == 1000
        assert config.on_error is None
        assert config.on_flush is None

    def test_custom_values(self) -> None:
        """QueueConfig accepts custom values."""
        on_error = MagicMock()
        on_flush = MagicMock()
        config = QueueConfig(
            batch_size=100,
            flush_interval=10.0,
            max_queue_size=500,
            on_error=on_error,
            on_flush=on_flush,
        )
        assert config.batch_size == 100
        assert config.flush_interval == 10.0
        assert config.max_queue_size == 500
        assert config.on_error is on_error
        assert config.on_flush is on_flush

    def test_partial_custom_values(self) -> None:
        """QueueConfig allows partial override of defaults."""
        config = QueueConfig(batch_size=25)
        assert config.batch_size == 25
        assert config.flush_interval == 5.0  # default
        assert config.max_queue_size == 1000  # default


class TestQueueConfigFromLogwellConfig:
    """Tests for QueueConfig.from_logwell_config classmethod."""

    def test_extracts_queue_config_values(self, valid_config_full: Any) -> None:
        """Extracts queue-related values from LogwellConfig."""
        config = QueueConfig.from_logwell_config(valid_config_full)
        assert config.batch_size == 100
        assert config.flush_interval == 10.0
        assert config.max_queue_size == 500

    def test_uses_defaults_for_missing_values(self, valid_config: Any) -> None:
        """Uses default values for missing config keys."""
        config = QueueConfig.from_logwell_config(valid_config)
        assert config.batch_size == 50
        assert config.flush_interval == 5.0
        assert config.max_queue_size == 1000
        assert config.on_error is None
        assert config.on_flush is None

    def test_extracts_callbacks(self, valid_config: Any) -> None:
        """Extracts on_error and on_flush callbacks."""
        on_error = MagicMock()
        on_flush = MagicMock()
        logwell_config = dict(valid_config)
        logwell_config["on_error"] = on_error
        logwell_config["on_flush"] = on_flush

        config = QueueConfig.from_logwell_config(logwell_config)
        assert config.on_error is on_error
        assert config.on_flush is on_flush


# =============================================================================
# BatchQueue Construction Tests
# =============================================================================


class TestBatchQueueConstruction:
    """Tests for BatchQueue construction."""

    def test_accepts_queue_config(self) -> None:
        """BatchQueue accepts QueueConfig."""
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=10)
        queue = BatchQueue(send_batch, config)
        assert queue.size == 0

    def test_accepts_logwell_config(self, valid_config: Any) -> None:
        """BatchQueue accepts LogwellConfig and converts it."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, valid_config)
        assert queue.size == 0

    def test_starts_empty(self) -> None:
        """BatchQueue starts with size 0."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())
        assert queue.size == 0


# =============================================================================
# BatchQueue.add() Tests
# =============================================================================


class TestBatchQueueAdd:
    """Tests for BatchQueue.add() method."""

    def test_add_increases_size(self) -> None:
        """add() increases queue size by 1."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("first"))
        assert queue.size == 1

        queue.add(make_log_entry("second"))
        assert queue.size == 2

    def test_add_multiple_entries(self) -> None:
        """add() handles multiple entries sequentially."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        for i in range(10):
            queue.add(make_log_entry(f"message_{i}"))

        assert queue.size == 10

    @pytest.mark.asyncio
    async def test_add_after_shutdown_is_ignored(self) -> None:
        """add() is ignored after shutdown()."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("before"))
        assert queue.size == 1

        await queue.shutdown()
        queue.add(make_log_entry("after"))
        # Should still be 0 since shutdown flushed and new add ignored
        assert queue.size == 0


# =============================================================================
# BatchQueue.size Tests
# =============================================================================


class TestBatchQueueSize:
    """Tests for BatchQueue.size property."""

    def test_size_starts_at_zero(self) -> None:
        """size is 0 for new queue."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())
        assert queue.size == 0

    def test_size_reflects_queue_length(self) -> None:
        """size accurately reflects number of entries."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        assert queue.size == 0
        queue.add(make_log_entry())
        assert queue.size == 1
        queue.add(make_log_entry())
        assert queue.size == 2

    @pytest.mark.asyncio
    async def test_size_zero_after_flush(self) -> None:
        """size is 0 after flush()."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())
        queue.add(make_log_entry())
        assert queue.size == 2

        await queue.flush()
        assert queue.size == 0


# =============================================================================
# BatchQueue.flush() Tests
# =============================================================================


class TestBatchQueueFlush:
    """Tests for BatchQueue.flush() method."""

    @pytest.mark.asyncio
    async def test_flush_calls_send_batch_with_entries(self) -> None:
        """flush() calls send_batch with queued entries."""
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        await queue.flush()

        assert len(captured) == 1
        assert len(captured[0]) == 2
        assert captured[0][0]["message"] == "one"
        assert captured[0][1]["message"] == "two"

    @pytest.mark.asyncio
    async def test_flush_clears_queue(self) -> None:
        """flush() empties the queue."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())
        queue.add(make_log_entry())
        assert queue.size == 2

        await queue.flush()
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_flush_returns_response(self) -> None:
        """flush() returns the IngestResponse from send_batch."""
        response: IngestResponse = {"accepted": 5, "rejected": 0}
        send_batch, _ = make_send_batch_mock(response=response)
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())

        result = await queue.flush()
        assert result == response

    @pytest.mark.asyncio
    async def test_flush_empty_queue_returns_none(self) -> None:
        """flush() on empty queue returns None without calling send_batch."""
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())

        result = await queue.flush()

        assert result is None
        assert len(captured) == 0

    @pytest.mark.asyncio
    async def test_flush_calls_on_flush_callback(self) -> None:
        """flush() calls on_flush callback with count."""
        on_flush = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, on_flush=on_flush)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry())
        queue.add(make_log_entry())
        queue.add(make_log_entry())

        await queue.flush()

        on_flush.assert_called_once_with(3)

    @pytest.mark.asyncio
    async def test_flush_requeues_on_error(self) -> None:
        """flush() re-queues entries on send_batch error."""
        error = Exception("Network error")
        send_batch, _ = make_send_batch_mock(error=error)
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        await queue.flush()

        # Entries should be re-queued
        assert queue.size == 2

    @pytest.mark.asyncio
    async def test_flush_calls_on_error_callback_on_failure(self) -> None:
        """flush() calls on_error callback when send_batch fails."""
        error = Exception("Network error")
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock(error=error)
        config = QueueConfig(batch_size=100, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry())
        await queue.flush()

        on_error.assert_called_once_with(error)

    @pytest.mark.asyncio
    async def test_concurrent_flush_prevented(self) -> None:
        """Concurrent flush() calls are prevented."""
        call_count = 0
        flush_started = asyncio.Event()
        flush_continue = asyncio.Event()

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            nonlocal call_count
            call_count += 1
            flush_started.set()
            # Wait until test signals to continue
            await flush_continue.wait()
            return {"accepted": len(batch)}

        mock = MagicMock(side_effect=slow_send)
        queue = BatchQueue(mock, QueueConfig(batch_size=100))

        queue.add(make_log_entry())
        queue.add(make_log_entry())

        # Start first flush in background
        task1 = asyncio.create_task(queue.flush())

        # Wait for first flush to start
        await flush_started.wait()

        # Try second flush while first is in progress
        result2 = await queue.flush()

        # Second flush should return None (skipped)
        assert result2 is None

        # Let first flush complete
        flush_continue.set()
        await task1

        # Only one actual send should have happened
        assert call_count == 1


# =============================================================================
# Auto-Flush on Batch Size Tests
# =============================================================================


class TestAutoFlushOnBatchSize:
    """Tests for automatic flush when batch_size threshold is reached."""

    @pytest.mark.asyncio
    async def test_auto_flush_triggers_at_batch_size(self) -> None:
        """Auto-flush triggers when batch_size entries are added."""
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=3))

        # Add up to batch_size
        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))
        # Size should be 2, no flush yet

        queue.add(make_log_entry("three"))
        # This should trigger auto-flush

        # Give async flush time to complete
        await asyncio.sleep(0.1)

        assert len(captured) >= 1
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_auto_flush_sends_batch_size_entries(self) -> None:
        """Auto-flush sends exactly batch_size entries."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=5)
        queue = BatchQueue(send_batch, config)

        for i in range(5):
            queue.add(make_log_entry(f"msg_{i}"))

        await asyncio.sleep(0.1)

        assert len(captured) == 1
        assert len(captured[0]) == 5

    @pytest.mark.asyncio
    async def test_batch_size_of_one_flushes_immediately(self) -> None:
        """batch_size=1 causes immediate flush on each add."""
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=1))

        queue.add(make_log_entry("first"))
        await asyncio.sleep(0.1)
        assert len(captured) >= 1

        queue.add(make_log_entry("second"))
        await asyncio.sleep(0.1)
        assert len(captured) >= 2


# =============================================================================
# Timer-Based Flush Tests
# =============================================================================


class TestTimerBasedFlush:
    """Tests for timer-based automatic flush."""

    @pytest.mark.asyncio
    async def test_timer_starts_on_first_add(self) -> None:
        """Timer starts when first entry is added."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.1)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry())

        # Wait for timer to fire
        await asyncio.sleep(0.2)

        assert len(captured) >= 1
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_timer_flush_with_partial_batch(self) -> None:
        """Timer flushes even when batch_size not reached."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.1)
        queue = BatchQueue(send_batch, config)

        # Add fewer entries than batch_size
        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        # Wait for timer
        await asyncio.sleep(0.2)

        assert len(captured) >= 1
        assert len(captured[0]) == 2

    @pytest.mark.asyncio
    async def test_timer_reset_after_flush(self) -> None:
        """Timer is reset after manual flush if queue not empty."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.15)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("first"))
        await queue.flush()

        # Add more entries
        queue.add(make_log_entry("second"))

        # Wait for timer
        await asyncio.sleep(0.25)

        # Should have flushed both times
        assert len(captured) >= 2


# =============================================================================
# Queue Overflow Tests
# =============================================================================


class TestQueueOverflow:
    """Tests for queue overflow handling."""

    def test_overflow_drops_oldest_entry(self) -> None:
        """Overflow drops oldest entry when max_queue_size exceeded."""
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=3)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))
        queue.add(make_log_entry("three"))
        assert queue.size == 3

        # This should drop "one"
        queue.add(make_log_entry("four"))
        assert queue.size == 3

    @pytest.mark.asyncio
    async def test_overflow_preserves_newest_entries(self) -> None:
        """Overflow keeps newest entries, drops oldest."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=3)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))
        queue.add(make_log_entry("three"))
        queue.add(make_log_entry("four"))  # Drops "one"
        queue.add(make_log_entry("five"))  # Drops "two"

        await queue.flush()

        assert len(captured[0]) == 3
        messages = [e["message"] for e in captured[0]]
        assert messages == ["three", "four", "five"]

    def test_overflow_calls_on_error(self) -> None:
        """Overflow calls on_error callback with LogwellError."""
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=2, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))
        queue.add(make_log_entry("three"))  # Overflow!

        on_error.assert_called_once()
        error = on_error.call_args[0][0]
        assert isinstance(error, LogwellError)
        assert error.code == LogwellErrorCode.QUEUE_OVERFLOW

    def test_overflow_error_includes_dropped_message(self) -> None:
        """Overflow error message includes preview of dropped log."""
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("important message"))
        queue.add(make_log_entry("new message"))

        error = on_error.call_args[0][0]
        assert "important message" in error.message

    def test_overflow_truncates_long_messages(self) -> None:
        """Overflow error truncates long dropped message preview."""
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        long_msg = "A" * 100
        queue.add(make_log_entry(long_msg))
        queue.add(make_log_entry("new"))

        error = on_error.call_args[0][0]
        # Message preview should be truncated to 50 chars (the full message is longer)
        # The error message includes context, but the dropped log preview is truncated
        assert "A" * 50 in error.message  # First 50 chars included
        assert "A" * 100 not in error.message  # Full message NOT included

    def test_no_on_error_callback_no_exception(self) -> None:
        """Overflow without on_error callback doesn't raise."""
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=None)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("one"))
        # Should not raise
        queue.add(make_log_entry("two"))
        assert queue.size == 1


# =============================================================================
# Shutdown Tests
# =============================================================================


class TestBatchQueueShutdown:
    """Tests for BatchQueue.shutdown() method."""

    @pytest.mark.asyncio
    async def test_shutdown_flushes_remaining(self) -> None:
        """shutdown() flushes remaining entries."""
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        await queue.shutdown()

        assert len(captured) == 1
        assert len(captured[0]) == 2

    @pytest.mark.asyncio
    async def test_shutdown_sets_stopped_flag(self) -> None:
        """shutdown() prevents further adds."""
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        await queue.shutdown()

        queue.add(make_log_entry("ignored"))
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_shutdown_is_idempotent(self) -> None:
        """shutdown() can be called multiple times safely."""
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())

        await queue.shutdown()
        await queue.shutdown()
        await queue.shutdown()

        # Should only flush once
        assert len(captured) == 1

    @pytest.mark.asyncio
    async def test_shutdown_empty_queue_no_flush(self) -> None:
        """shutdown() on empty queue doesn't call send_batch."""
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())

        await queue.shutdown()

        assert len(captured) == 0

    @pytest.mark.asyncio
    async def test_shutdown_stops_timer(self) -> None:
        """shutdown() stops the flush timer."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.1)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry())
        await queue.shutdown()

        # Wait past flush interval
        await asyncio.sleep(0.2)

        # Timer should not have fired again (only shutdown flush)
        assert len(captured) == 1


# =============================================================================
# Thread Safety Tests
# =============================================================================


class TestBatchQueueThreadSafety:
    """Tests for BatchQueue thread safety."""

    @pytest.mark.asyncio
    async def test_concurrent_adds_are_thread_safe(self) -> None:
        """Multiple threads can add() concurrently without data loss."""
        send_batch, captured = make_send_batch_mock()
        # Use very high batch_size to prevent auto-flush during test
        config = QueueConfig(batch_size=100000, max_queue_size=100000)
        queue = BatchQueue(send_batch, config)

        num_threads = 10
        entries_per_thread = 100
        total_expected = num_threads * entries_per_thread

        def add_entries(thread_id: int) -> None:
            for i in range(entries_per_thread):
                queue.add(make_log_entry(f"thread_{thread_id}_msg_{i}"))

        threads = [threading.Thread(target=add_entries, args=(i,)) for i in range(num_threads)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert queue.size == total_expected

    @pytest.mark.asyncio
    async def test_concurrent_add_and_flush(self) -> None:
        """Concurrent add() and flush() don't cause race conditions."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=1000)
        queue = BatchQueue(send_batch, config)

        num_adds = 100
        add_complete = threading.Event()

        def add_entries() -> None:
            for i in range(num_adds):
                queue.add(make_log_entry(f"msg_{i}"))
                time.sleep(0.001)  # Small delay to interleave with flush
            add_complete.set()

        async def periodic_flush() -> None:
            while not add_complete.is_set():
                await queue.flush()
                await asyncio.sleep(0.01)
            # Final flush
            await queue.flush()

        # Start adding in background thread
        add_thread = threading.Thread(target=add_entries)
        add_thread.start()

        # Flush periodically from async context
        await periodic_flush()

        add_thread.join()

        # All entries should have been captured
        total_captured = sum(len(batch) for batch in captured)
        assert total_captured == num_adds

    def test_size_is_thread_safe(self) -> None:
        """Reading size while adding doesn't cause race conditions."""
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=10000)
        queue = BatchQueue(send_batch, config)

        num_adds = 1000
        sizes: list[int] = []

        def add_entries() -> None:
            for _ in range(num_adds):
                queue.add(make_log_entry())

        def read_size() -> None:
            for _ in range(num_adds):
                sizes.append(queue.size)

        t1 = threading.Thread(target=add_entries)
        t2 = threading.Thread(target=read_size)

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Final size should be correct
        assert queue.size == num_adds
        # All size readings should be valid (0 to num_adds)
        assert all(0 <= s <= num_adds for s in sizes)


# =============================================================================
# Edge Cases
# =============================================================================


class TestBatchQueueEdgeCases:
    """Edge case tests for BatchQueue."""

    @pytest.mark.asyncio
    async def test_flush_during_send_batch_error_preserves_order(self) -> None:
        """Re-queued entries maintain order when error occurs."""
        call_count = 0

        async def failing_then_success(batch: list[LogEntry]) -> IngestResponse:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("First call fails")
            return {"accepted": len(batch)}

        mock = MagicMock(side_effect=failing_then_success)
        config = QueueConfig(batch_size=100)
        queue = BatchQueue(mock, config)

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        # First flush fails
        await queue.flush()
        assert queue.size == 2  # Re-queued

        # Second flush succeeds
        result = await queue.flush()
        assert result is not None
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_entries_added_during_flush_are_preserved(self) -> None:
        """Entries added during flush are not lost."""
        flush_started = asyncio.Event()
        flush_continue = asyncio.Event()
        captured_batches: list[list[LogEntry]] = []

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            captured_batches.append(batch)
            flush_started.set()
            await flush_continue.wait()
            return {"accepted": len(batch)}

        mock = MagicMock(side_effect=slow_send)
        queue = BatchQueue(mock, QueueConfig(batch_size=100))

        queue.add(make_log_entry("before"))

        # Start flush
        flush_task = asyncio.create_task(queue.flush())

        # Wait for flush to start
        await flush_started.wait()

        # Add during flush
        queue.add(make_log_entry("during"))

        # Complete flush
        flush_continue.set()
        await flush_task

        # Entry added during flush should be in queue
        assert queue.size == 1

        # Flush again to capture the "during" entry
        await queue.flush()
        assert len(captured_batches) == 2
        assert captured_batches[0][0]["message"] == "before"
        assert captured_batches[1][0]["message"] == "during"

    @pytest.mark.asyncio
    async def test_empty_message_in_overflow(self) -> None:
        """Overflow handles empty message gracefully."""
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        queue.add({"level": "info", "message": ""})  # type: ignore[typeddict-item]
        queue.add(make_log_entry("new"))

        # Should not raise, error should be called
        on_error.assert_called_once()

    @pytest.mark.asyncio
    async def test_very_large_batch(self) -> None:
        """Queue handles very large batches."""
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=10000, max_queue_size=20000)
        queue = BatchQueue(send_batch, config)

        for i in range(5000):
            queue.add(make_log_entry(f"msg_{i}"))

        await queue.flush()

        assert len(captured) == 1
        assert len(captured[0]) == 5000
