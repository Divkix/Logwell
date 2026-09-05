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


def make_log_entry(message: str = "test", level: str = "info") -> LogEntry:
    return {"level": level, "message": message}  # type: ignore[typeddict-item]


def make_send_batch_mock(
    response: IngestResponse | None = None,
    error: Exception | None = None,
) -> tuple[MagicMock, list[list[LogEntry]]]:
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


class TestQueueConfigConstruction:
    def test_default_values(self) -> None:
        config = QueueConfig()
        assert config.batch_size == 50
        assert config.flush_interval == 5.0
        assert config.max_queue_size == 1000
        assert config.on_error is None
        assert config.on_flush is None

    def test_custom_values(self) -> None:
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
        config = QueueConfig(batch_size=25)
        assert config.batch_size == 25
        assert config.flush_interval == 5.0  # default
        assert config.max_queue_size == 1000  # default


class TestQueueConfigFromLogwellConfig:
    def test_extracts_queue_config_values(self, valid_config_full: Any) -> None:
        config = QueueConfig.from_logwell_config(valid_config_full)
        assert config.batch_size == 100
        assert config.flush_interval == 10.0
        assert config.max_queue_size == 500

    def test_uses_defaults_for_missing_values(self, valid_config: Any) -> None:
        config = QueueConfig.from_logwell_config(valid_config)
        assert config.batch_size == 50
        assert config.flush_interval == 5.0
        assert config.max_queue_size == 1000
        assert config.on_error is None
        assert config.on_flush is None

    def test_extracts_callbacks(self, valid_config: Any) -> None:
        on_error = MagicMock()
        on_flush = MagicMock()
        logwell_config = dict(valid_config)
        logwell_config["on_error"] = on_error
        logwell_config["on_flush"] = on_flush

        config = QueueConfig.from_logwell_config(logwell_config)
        assert config.on_error is on_error
        assert config.on_flush is on_flush


class TestBatchQueueConstruction:
    def test_accepts_queue_config(self) -> None:
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=10)
        queue = BatchQueue(send_batch, config)
        assert queue.size == 0

    def test_accepts_logwell_config(self, valid_config: Any) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, valid_config)
        assert queue.size == 0

    def test_starts_empty(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())
        assert queue.size == 0


class TestBatchQueueAdd:
    def test_add_increases_size(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("first"))
        assert queue.size == 1

        queue.add(make_log_entry("second"))
        assert queue.size == 2

    def test_add_multiple_entries(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        for i in range(10):
            queue.add(make_log_entry(f"message_{i}"))

        assert queue.size == 10

    @pytest.mark.asyncio
    async def test_add_after_shutdown_is_ignored(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("before"))
        assert queue.size == 1

        await queue.shutdown()
        queue.add(make_log_entry("after"))
        assert queue.size == 0


class TestBatchQueueSize:
    def test_size_starts_at_zero(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())
        assert queue.size == 0

    def test_size_reflects_queue_length(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        assert queue.size == 0
        queue.add(make_log_entry())
        assert queue.size == 1
        queue.add(make_log_entry())
        assert queue.size == 2

    @pytest.mark.asyncio
    async def test_size_zero_after_flush(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())
        queue.add(make_log_entry())
        assert queue.size == 2

        await queue.flush()
        assert queue.size == 0


class TestBatchQueueFlush:
    @pytest.mark.asyncio
    async def test_flush_calls_send_batch_with_entries(self) -> None:
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
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())
        queue.add(make_log_entry())
        assert queue.size == 2

        await queue.flush()
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_flush_returns_response(self) -> None:
        response: IngestResponse = {"accepted": 5, "rejected": 0}
        send_batch, _ = make_send_batch_mock(response=response)
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())

        result = await queue.flush()
        assert result == response

    @pytest.mark.asyncio
    async def test_flush_empty_queue_returns_none(self) -> None:
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())

        result = await queue.flush()

        assert result is None
        assert len(captured) == 0

    @pytest.mark.asyncio
    async def test_flush_calls_on_flush_callback(self) -> None:
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
        error = Exception("Network error")
        send_batch, _ = make_send_batch_mock(error=error)
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        await queue.flush()

        assert queue.size == 2

    @pytest.mark.asyncio
    async def test_flush_calls_on_error_callback_on_failure(self) -> None:
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
        call_count = 0
        flush_started = threading.Event()
        flush_continue = threading.Event()

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            nonlocal call_count
            call_count += 1
            flush_started.set()
            while not flush_continue.is_set():
                await asyncio.sleep(0.01)
            return {"accepted": len(batch)}

        mock = MagicMock(side_effect=slow_send)
        queue = BatchQueue(mock, QueueConfig(batch_size=100))

        queue.add(make_log_entry())
        queue.add(make_log_entry())

        task1 = asyncio.create_task(queue.flush())

        while not flush_started.is_set():
            await asyncio.sleep(0.01)

        result2 = await queue.flush()

        assert result2 is None

        flush_continue.set()
        await task1

        assert call_count == 1


class TestAutoFlushOnBatchSize:
    @pytest.mark.asyncio
    async def test_auto_flush_triggers_at_batch_size(self) -> None:
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=3))

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        queue.add(make_log_entry("three"))

        await asyncio.sleep(0.1)

        assert len(captured) >= 1
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_auto_flush_sends_batch_size_entries(self) -> None:
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
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=1))

        queue.add(make_log_entry("first"))
        await asyncio.sleep(0.1)
        assert len(captured) >= 1

        queue.add(make_log_entry("second"))
        await asyncio.sleep(0.1)
        assert len(captured) >= 2


class TestTimerBasedFlush:
    @pytest.mark.asyncio
    async def test_timer_starts_on_first_add(self) -> None:
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.1)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry())

        await asyncio.sleep(0.2)

        assert len(captured) >= 1
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_timer_flush_with_partial_batch(self) -> None:
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.1)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        await asyncio.sleep(0.2)

        assert len(captured) >= 1
        assert len(captured[0]) == 2

    @pytest.mark.asyncio
    async def test_timer_reset_after_flush(self) -> None:
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.15)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("first"))
        await queue.flush()

        queue.add(make_log_entry("second"))

        await asyncio.sleep(0.25)

        assert len(captured) >= 2


class TestQueueOverflow:
    def test_overflow_drops_oldest_entry(self) -> None:
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=3)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))
        queue.add(make_log_entry("three"))
        assert queue.size == 3

        queue.add(make_log_entry("four"))
        assert queue.size == 3

    @pytest.mark.asyncio
    async def test_overflow_preserves_newest_entries(self) -> None:
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
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("important message"))
        queue.add(make_log_entry("new message"))

        error = on_error.call_args[0][0]
        assert "important message" in error.message

    def test_overflow_truncates_long_messages(self) -> None:
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        long_msg = "A" * 100
        queue.add(make_log_entry(long_msg))
        queue.add(make_log_entry("new"))

        error = on_error.call_args[0][0]
        assert "A" * 50 in error.message  # First 50 chars included
        assert "A" * 100 not in error.message  # Full message NOT included

    def test_no_on_error_callback_no_exception(self) -> None:
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=None)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))
        assert queue.size == 1


class TestBatchQueueShutdown:
    @pytest.mark.asyncio
    async def test_shutdown_flushes_remaining(self) -> None:
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        await queue.shutdown()

        assert len(captured) == 1
        assert len(captured[0]) == 2

    @pytest.mark.asyncio
    async def test_shutdown_sets_stopped_flag(self) -> None:
        send_batch, _ = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        await queue.shutdown()

        queue.add(make_log_entry("ignored"))
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_shutdown_is_idempotent(self) -> None:
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig(batch_size=100))

        queue.add(make_log_entry())

        await queue.shutdown()
        await queue.shutdown()
        await queue.shutdown()

        assert len(captured) == 1

    @pytest.mark.asyncio
    async def test_shutdown_empty_queue_no_flush(self) -> None:
        send_batch, captured = make_send_batch_mock()
        queue = BatchQueue(send_batch, QueueConfig())

        await queue.shutdown()

        assert len(captured) == 0

    @pytest.mark.asyncio
    async def test_shutdown_stops_timer(self) -> None:
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=100, flush_interval=0.1)
        queue = BatchQueue(send_batch, config)

        queue.add(make_log_entry())
        await queue.shutdown()

        await asyncio.sleep(0.2)

        assert len(captured) == 1

    @pytest.mark.asyncio
    async def test_shutdown_awaits_in_flight_flush(self) -> None:
        flush_started = threading.Event()
        flush_continue = threading.Event()
        captured: list[list[LogEntry]] = []

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            captured.append(batch)
            flush_started.set()
            while not flush_continue.is_set():
                await asyncio.sleep(0.01)
            return {"accepted": len(batch)}

        queue = BatchQueue(MagicMock(side_effect=slow_send), QueueConfig(batch_size=100))
        queue.add(make_log_entry("one"))
        queue.add(make_log_entry("two"))

        flush_task = asyncio.create_task(queue.flush())
        while not flush_started.is_set():
            await asyncio.sleep(0.01)

        shutdown_task = asyncio.create_task(queue.shutdown())

        await asyncio.sleep(0.05)
        assert not shutdown_task.done()

        flush_continue.set()
        await shutdown_task
        await flush_task

        assert [e["message"] for batch in captured for e in batch] == ["one", "two"]
        assert queue._queue_loop is None

    @pytest.mark.asyncio
    async def test_shutdown_awaits_triggered_flush(self) -> None:
        flush_started = threading.Event()
        flush_continue = threading.Event()
        captured: list[list[LogEntry]] = []

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            captured.append(batch)
            flush_started.set()
            while not flush_continue.is_set():
                await asyncio.sleep(0.01)
            return {"accepted": len(batch)}

        queue = BatchQueue(MagicMock(side_effect=slow_send), QueueConfig(batch_size=1))
        queue.add(make_log_entry("one"))
        while not flush_started.is_set():
            await asyncio.sleep(0.01)

        shutdown_task = asyncio.create_task(queue.shutdown())
        await asyncio.sleep(0.05)
        assert not shutdown_task.done()

        flush_continue.set()
        await shutdown_task

        assert [e["message"] for batch in captured for e in batch] == ["one"]
        assert queue._queue_loop is None


class TestFlushFutureGating:
    @pytest.mark.asyncio
    async def test_no_new_flush_future_while_in_flight(self) -> None:
        flush_started = threading.Event()
        flush_continue = threading.Event()
        captured: list[list[LogEntry]] = []

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            captured.append(batch)
            flush_started.set()
            while not flush_continue.is_set():
                await asyncio.sleep(0.01)
            return {"accepted": len(batch)}

        config = QueueConfig(batch_size=1, flush_interval=0.05)
        queue = BatchQueue(MagicMock(side_effect=slow_send), config)

        queue.add(make_log_entry("one"))
        while not flush_started.is_set():
            await asyncio.sleep(0.01)

        first_future = queue._flush_future
        assert first_future is not None
        assert queue._flushing is True

        queue.add(make_log_entry("two"))

        assert queue._flush_future is first_future
        assert queue._flushing is True
        assert len(captured) == 1

        flush_continue.set()
        deadline = time.monotonic() + 1.0
        while len(captured) < 2 and time.monotonic() < deadline:
            await asyncio.sleep(0.01)

        assert len(captured) == 2
        assert [e["message"] for batch in captured for e in batch] == ["one", "two"]
        await queue.shutdown()

    @pytest.mark.asyncio
    async def test_flush_returns_none_while_in_flight(self) -> None:
        flush_started = threading.Event()
        flush_continue = threading.Event()
        call_count = 0

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            nonlocal call_count
            call_count += 1
            flush_started.set()
            while not flush_continue.is_set():
                await asyncio.sleep(0.01)
            return {"accepted": len(batch)}

        queue = BatchQueue(MagicMock(side_effect=slow_send), QueueConfig(batch_size=100))
        queue.add(make_log_entry())
        queue.add(make_log_entry())

        flush_task = asyncio.create_task(queue.flush())
        while not flush_started.is_set():
            await asyncio.sleep(0.01)

        result = await queue.flush()
        assert result is None
        assert call_count == 1

        flush_continue.set()
        await flush_task
        assert call_count == 1
        await queue.shutdown()


class TestBatchQueueThreadSafety:
    @pytest.mark.asyncio
    async def test_concurrent_adds_are_thread_safe(self) -> None:
        send_batch, captured = make_send_batch_mock()
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
            await queue.flush()

        add_thread = threading.Thread(target=add_entries)
        add_thread.start()

        await periodic_flush()

        add_thread.join()

        total_captured = sum(len(batch) for batch in captured)
        assert total_captured == num_adds

    def test_size_is_thread_safe(self) -> None:
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

        assert queue.size == num_adds
        assert all(0 <= s <= num_adds for s in sizes)


class TestBatchQueueEdgeCases:
    @pytest.mark.asyncio
    async def test_flush_during_send_batch_error_preserves_order(self) -> None:
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

        await queue.flush()
        assert queue.size == 2  # Re-queued

        result = await queue.flush()
        assert result is not None
        assert queue.size == 0

    @pytest.mark.asyncio
    async def test_entries_added_during_flush_are_preserved(self) -> None:
        flush_started = threading.Event()
        flush_continue = threading.Event()
        captured_batches: list[list[LogEntry]] = []

        async def slow_send(batch: list[LogEntry]) -> IngestResponse:
            captured_batches.append(batch)
            flush_started.set()
            while not flush_continue.is_set():
                await asyncio.sleep(0.01)
            return {"accepted": len(batch)}

        mock = MagicMock(side_effect=slow_send)
        queue = BatchQueue(mock, QueueConfig(batch_size=100))

        queue.add(make_log_entry("before"))

        flush_task = asyncio.create_task(queue.flush())

        while not flush_started.is_set():
            await asyncio.sleep(0.01)

        queue.add(make_log_entry("during"))

        flush_continue.set()
        await flush_task

        assert queue.size == 1

        await queue.flush()
        assert len(captured_batches) == 2
        assert captured_batches[0][0]["message"] == "before"
        assert captured_batches[1][0]["message"] == "during"

    @pytest.mark.asyncio
    async def test_empty_message_in_overflow(self) -> None:
        on_error = MagicMock()
        send_batch, _ = make_send_batch_mock()
        config = QueueConfig(batch_size=100, max_queue_size=1, on_error=on_error)
        queue = BatchQueue(send_batch, config)

        queue.add({"level": "info", "message": ""})  # type: ignore[typeddict-item]
        queue.add(make_log_entry("new"))

        on_error.assert_called_once()

    @pytest.mark.asyncio
    async def test_very_large_batch(self) -> None:
        send_batch, captured = make_send_batch_mock()
        config = QueueConfig(batch_size=10000, max_queue_size=20000)
        queue = BatchQueue(send_batch, config)

        for i in range(5000):
            queue.add(make_log_entry(f"msg_{i}"))

        await queue.flush()

        assert len(captured) == 1
        assert len(captured[0]) == 5000
