from __future__ import annotations

import asyncio
import threading
import time
from typing import TYPE_CHECKING
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
        return response

    mock = MagicMock(side_effect=mock_send)
    return mock, captured


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


class TestBatchQueueShutdown:
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
