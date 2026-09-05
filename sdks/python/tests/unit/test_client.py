from __future__ import annotations

from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from logwell.client import Logwell
from logwell.errors import LogwellError, LogwellErrorCode
from logwell.queue import BatchQueue

if TYPE_CHECKING:
    from logwell.types import LogEntry, LogwellConfig


def make_mock_queue() -> tuple[MagicMock, list[LogEntry]]:
    captured: list[LogEntry] = []
    mock_queue = MagicMock(spec=BatchQueue)
    mock_queue.size = 0

    def add_entry(entry: LogEntry) -> None:
        captured.append(entry)
        mock_queue.size = len(captured)

    mock_queue.add = MagicMock(side_effect=add_entry)
    mock_queue.flush = AsyncMock(return_value={"accepted": 1})
    mock_queue.shutdown = AsyncMock()

    return mock_queue, captured


class TestLogwellConstruction:
    def test_valid_config_minimal(self, valid_config: LogwellConfig) -> None:
        client = Logwell(valid_config)
        assert client.queue_size == 0

    def test_valid_config_full(self, valid_config_full: LogwellConfig) -> None:
        client = Logwell(valid_config_full)
        assert client.queue_size == 0

    def test_invalid_config_missing_api_key(self, valid_endpoint: str) -> None:
        config: dict[str, Any] = {"endpoint": valid_endpoint}

        with pytest.raises(LogwellError) as exc_info:
            Logwell(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG

    def test_invalid_config_missing_endpoint(self, valid_api_key: str) -> None:
        config: dict[str, Any] = {"api_key": valid_api_key}

        with pytest.raises(LogwellError) as exc_info:
            Logwell(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG

    def test_invalid_config_bad_api_key_format(self, valid_endpoint: str) -> None:
        config: dict[str, Any] = {
            "api_key": "invalid_key",
            "endpoint": valid_endpoint,
        }

        with pytest.raises(LogwellError) as exc_info:
            Logwell(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG

    def test_invalid_config_bad_endpoint_format(self, valid_api_key: str) -> None:
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "not-a-url",
        }

        with pytest.raises(LogwellError) as exc_info:
            Logwell(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG

    def test_invalid_config_negative_batch_size(
        self, valid_api_key: str, valid_endpoint: str
    ) -> None:
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "batch_size": -1,
        }

        with pytest.raises(LogwellError) as exc_info:
            Logwell(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG

    def test_creates_own_queue_by_default(self, valid_config: LogwellConfig) -> None:
        client = Logwell(valid_config)
        assert client._owns_queue is True

    def test_uses_provided_queue(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        assert client._owns_queue is False
        assert client._queue is mock_queue


class TestLogMethods:
    @pytest.fixture
    def client_with_mock(self, valid_config: LogwellConfig) -> tuple[Logwell, list[LogEntry]]:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        return client, captured

    def test_debug_logs_at_debug_level(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.debug("Debug message")

        assert len(captured) == 1
        assert captured[0]["level"] == "debug"
        assert captured[0]["message"] == "Debug message"

    def test_info_logs_at_info_level(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.info("Info message")

        assert len(captured) == 1
        assert captured[0]["level"] == "info"
        assert captured[0]["message"] == "Info message"

    def test_warn_logs_at_warn_level(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.warn("Warning message")

        assert len(captured) == 1
        assert captured[0]["level"] == "warn"
        assert captured[0]["message"] == "Warning message"

    def test_error_logs_at_error_level(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.error("Error message")

        assert len(captured) == 1
        assert captured[0]["level"] == "error"
        assert captured[0]["message"] == "Error message"

    def test_fatal_logs_at_fatal_level(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.fatal("Fatal message")

        assert len(captured) == 1
        assert captured[0]["level"] == "fatal"
        assert captured[0]["message"] == "Fatal message"

    def test_log_method_accepts_entry_dict(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        entry: LogEntry = {"level": "info", "message": "Direct entry"}
        client.log(entry)

        assert len(captured) == 1
        assert captured[0]["level"] == "info"
        assert captured[0]["message"] == "Direct entry"


class TestLogWithMetadata:
    @pytest.fixture
    def client_with_mock(self, valid_config: LogwellConfig) -> tuple[Logwell, list[LogEntry]]:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        return client, captured

    def test_debug_with_metadata(self, client_with_mock: tuple[Logwell, list[LogEntry]]) -> None:
        client, captured = client_with_mock
        client.debug("Debug", {"key": "value"})

        assert captured[0]["metadata"] == {"key": "value"}

    def test_info_with_metadata(self, client_with_mock: tuple[Logwell, list[LogEntry]]) -> None:
        client, captured = client_with_mock
        client.info("Info", {"user_id": "123"})

        assert captured[0]["metadata"] == {"user_id": "123"}

    def test_warn_with_metadata(self, client_with_mock: tuple[Logwell, list[LogEntry]]) -> None:
        client, captured = client_with_mock
        client.warn("Warning", {"count": 5})

        assert captured[0]["metadata"] == {"count": 5}

    def test_error_with_metadata(self, client_with_mock: tuple[Logwell, list[LogEntry]]) -> None:
        client, captured = client_with_mock
        client.error("Error", {"error_code": "E001"})

        assert captured[0]["metadata"] == {"error_code": "E001"}

    def test_fatal_with_metadata(self, client_with_mock: tuple[Logwell, list[LogEntry]]) -> None:
        client, captured = client_with_mock
        client.fatal("Fatal", {"crash_id": "xyz"})

        assert captured[0]["metadata"] == {"crash_id": "xyz"}

    def test_metadata_none_not_added(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.info("No metadata")

        assert "metadata" not in captured[0]

    def test_metadata_empty_dict_not_added(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.info("Empty metadata", {})

        assert "metadata" not in captured[0]

    def test_complex_metadata(self, client_with_mock: tuple[Logwell, list[LogEntry]]) -> None:
        client, captured = client_with_mock
        metadata = {
            "user": {"id": 123, "name": "Alice"},
            "tags": ["important", "urgent"],
            "nested": {"deep": {"value": True}},
        }
        client.info("Complex", metadata)

        assert captured[0]["metadata"] == metadata


class TestLogTimestamp:
    @pytest.fixture
    def client_with_mock(self, valid_config: LogwellConfig) -> tuple[Logwell, list[LogEntry]]:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        return client, captured

    def test_timestamp_auto_generated(
        self, client_with_mock: tuple[Logwell, list[LogEntry]]
    ) -> None:
        client, captured = client_with_mock
        client.info("Test")

        assert "timestamp" in captured[0]
        timestamp = captured[0]["timestamp"]
        assert isinstance(timestamp, str)
        assert "T" in timestamp  # ISO 8601 format has T separator

    def test_timestamp_uses_utc(self, client_with_mock: tuple[Logwell, list[LogEntry]]) -> None:
        client, captured = client_with_mock
        client.info("Test")

        timestamp = captured[0]["timestamp"]
        assert "+00:00" in timestamp or timestamp.endswith("Z")


class TestServiceName:
    def test_service_from_config(self, valid_api_key: str, valid_endpoint: str) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "service": "my-service",
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)

        client.info("Test")

        assert captured[0]["service"] == "my-service"

    def test_no_service_in_config(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        client.info("Test")

        assert "service" not in captured[0]

    def test_service_from_entry_overrides_config(
        self, valid_api_key: str, valid_endpoint: str
    ) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "service": "config-service",
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)

        entry: LogEntry = {
            "level": "info",
            "message": "Test",
            "service": "entry-service",
        }
        client.log(entry)

        assert captured[0]["service"] == "entry-service"


class TestQueueSize:
    def test_queue_size_starts_at_zero(self, valid_config: LogwellConfig) -> None:
        client = Logwell(valid_config)
        assert client.queue_size == 0

    def test_queue_size_reflects_queue(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        mock_queue.size = 5
        client = Logwell(valid_config, _queue=mock_queue)

        assert client.queue_size == 5


class TestFlush:
    @pytest.mark.asyncio
    async def test_flush_calls_queue_flush(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        await client.flush()

        mock_queue.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_flush_returns_response(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        mock_queue.flush = AsyncMock(return_value={"accepted": 5, "rejected": 0})
        client = Logwell(valid_config, _queue=mock_queue)

        result = await client.flush()

        assert result == {"accepted": 5, "rejected": 0}

    @pytest.mark.asyncio
    async def test_flush_returns_none_when_empty(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        mock_queue.flush = AsyncMock(return_value=None)
        client = Logwell(valid_config, _queue=mock_queue)

        result = await client.flush()

        assert result is None


class TestShutdown:
    @pytest.mark.asyncio
    async def test_shutdown_calls_queue_shutdown(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        with patch.object(Logwell, "__init__", lambda s, c: None):
            client = Logwell.__new__(Logwell)
            client._config = valid_config
            client._queue = mock_queue
            client._owns_queue = True
            client._stopped = False
            client._transport = MagicMock()
            client._transport.close = AsyncMock()

        await client.shutdown()

        mock_queue.shutdown.assert_called_once()

    @pytest.mark.asyncio
    async def test_shutdown_closes_transport(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        mock_transport = MagicMock()
        mock_transport.close = AsyncMock()

        with patch.object(Logwell, "__init__", lambda s, c: None):
            client = Logwell.__new__(Logwell)
            client._config = valid_config
            client._queue = mock_queue
            client._owns_queue = True
            client._stopped = False
            client._transport = mock_transport

        await client.shutdown()

        mock_transport.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_shutdown_does_not_shutdown_shared_queue(
        self, valid_config: LogwellConfig
    ) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        await client.shutdown()

        mock_queue.shutdown.assert_not_called()

    @pytest.mark.asyncio
    async def test_shutdown_sets_stopped_flag(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        assert client._stopped is False
        await client.shutdown()
        assert client._stopped is True

    @pytest.mark.asyncio
    async def test_shutdown_rejects_new_logs(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        client.info("Before shutdown")
        await client.shutdown()
        client.info("After shutdown")

        assert len(captured) == 1
        assert captured[0]["message"] == "Before shutdown"

    @pytest.mark.asyncio
    async def test_shutdown_is_idempotent(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        mock_transport = MagicMock()
        mock_transport.close = AsyncMock()

        with patch.object(Logwell, "__init__", lambda s, c: None):
            client = Logwell.__new__(Logwell)
            client._config = valid_config
            client._queue = mock_queue
            client._owns_queue = True
            client._stopped = False
            client._transport = mock_transport

        await client.shutdown()
        await client.shutdown()
        await client.shutdown()

        assert mock_queue.shutdown.call_count == 3
        assert mock_transport.close.call_count == 3


class TestChild:
    def test_child_creates_new_client(self, valid_config: LogwellConfig) -> None:
        client = Logwell(valid_config)
        child = client.child()

        assert isinstance(child, Logwell)
        assert child is not client

    def test_child_shares_queue(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        child = client.child()

        assert child._queue is mock_queue

    def test_child_does_not_own_queue(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        child = client.child()

        assert child._owns_queue is False

    def test_child_inherits_config(self, valid_api_key: str, valid_endpoint: str) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "batch_size": 100,
            "flush_interval": 10.0,
            "max_queue_size": 500,
            "max_retries": 5,
        }
        mock_queue, _ = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)
        child = client.child()

        assert child._config["api_key"] == valid_api_key
        assert child._config["endpoint"] == valid_endpoint
        assert child._config["batch_size"] == 100
        assert child._config["flush_interval"] == 10.0
        assert child._config["max_queue_size"] == 500
        assert child._config["max_retries"] == 5

    def test_child_with_metadata(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        child = client.child({"request_id": "abc123"})

        child.info("Test message")

        assert captured[0]["metadata"]["request_id"] == "abc123"

    def test_child_metadata_merges_with_log_metadata(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        child = client.child({"request_id": "abc123"})

        child.info("Test", {"user_id": "user456"})

        assert captured[0]["metadata"]["request_id"] == "abc123"
        assert captured[0]["metadata"]["user_id"] == "user456"

    def test_child_log_metadata_overrides_child_metadata(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)
        child = client.child({"key": "child_value"})

        child.info("Test", {"key": "log_value"})

        assert captured[0]["metadata"]["key"] == "log_value"

    def test_child_with_service_override(self, valid_api_key: str, valid_endpoint: str) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "service": "parent-service",
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)
        child = client.child(service="child-service")

        child.info("Test")

        assert captured[0]["service"] == "child-service"

    def test_child_inherits_parent_service(self, valid_api_key: str, valid_endpoint: str) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "service": "parent-service",
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)
        child = client.child()

        child.info("Test")

        assert captured[0]["service"] == "parent-service"

    def test_child_inherits_callbacks(self, valid_api_key: str, valid_endpoint: str) -> None:
        on_error = MagicMock()
        on_flush = MagicMock()
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "on_error": on_error,
            "on_flush": on_flush,
        }
        mock_queue, _ = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)
        child = client.child()

        assert child._config["on_error"] is on_error
        assert child._config["on_flush"] is on_flush

    def test_child_inherits_capture_source_location(
        self, valid_api_key: str, valid_endpoint: str
    ) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "capture_source_location": True,
        }
        mock_queue, _ = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)
        child = client.child()

        assert child._config["capture_source_location"] is True


class TestNestedChildren:
    def test_grandchild_shares_root_queue(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        root = Logwell(valid_config, _queue=mock_queue)
        child = root.child()
        grandchild = child.child()

        assert grandchild._queue is mock_queue

    def test_nested_metadata_accumulates(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        root = Logwell(valid_config, _queue=mock_queue)
        child = root.child({"level1": "value1"})
        grandchild = child.child({"level2": "value2"})

        grandchild.info("Test")

        assert captured[0]["metadata"]["level1"] == "value1"
        assert captured[0]["metadata"]["level2"] == "value2"

    def test_nested_metadata_overrides_parent(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        root = Logwell(valid_config, _queue=mock_queue)
        child = root.child({"key": "parent_value"})
        grandchild = child.child({"key": "grandchild_value"})

        grandchild.info("Test")

        assert captured[0]["metadata"]["key"] == "grandchild_value"

    def test_deeply_nested_children(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        root = Logwell(valid_config, _queue=mock_queue)

        current = root
        for i in range(10):
            current = current.child({f"level_{i}": f"value_{i}"})

        current.info("Deep log")

        for i in range(10):
            assert captured[0]["metadata"][f"level_{i}"] == f"value_{i}"

    def test_sibling_children_independent(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        root = Logwell(valid_config, _queue=mock_queue)
        child1 = root.child({"child": "one"})
        child2 = root.child({"child": "two"})

        child1.info("From child1")
        child2.info("From child2")

        assert captured[0]["metadata"]["child"] == "one"
        assert captured[1]["metadata"]["child"] == "two"


class TestSourceLocationCapture:
    def test_source_location_disabled_by_default(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        client.info("Test")

        assert "sourceFile" not in captured[0]
        assert "lineNumber" not in captured[0]

    def test_source_location_captured_when_enabled(
        self, valid_api_key: str, valid_endpoint: str
    ) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "capture_source_location": True,
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)

        client.info("Test")

        assert "sourceFile" in captured[0]
        assert "lineNumber" in captured[0]
        assert isinstance(captured[0]["lineNumber"], int)
        assert captured[0]["lineNumber"] > 0

    def test_source_location_points_to_caller(
        self, valid_api_key: str, valid_endpoint: str
    ) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "capture_source_location": True,
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)

        client.info("Test")  # Line number should point to this line

        assert "test_client.py" in captured[0]["sourceFile"]

    def test_source_location_for_all_log_methods(
        self, valid_api_key: str, valid_endpoint: str
    ) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "capture_source_location": True,
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)

        client.debug("debug")
        client.info("info")
        client.warn("warn")
        client.error("error")
        client.fatal("fatal")

        for entry in captured:
            assert "sourceFile" in entry
            assert "lineNumber" in entry

    def test_child_inherits_source_location_setting(
        self, valid_api_key: str, valid_endpoint: str
    ) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "capture_source_location": True,
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)
        child = client.child({"request_id": "test"})

        child.info("Child log")

        assert "sourceFile" in captured[0]
        assert "lineNumber" in captured[0]


class TestMergeMetadata:
    def test_no_parent_no_entry_returns_none(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        result = client._merge_metadata(None)

        assert result is None

    def test_parent_only_returns_parent(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue, _parent_metadata={"parent": "value"})

        result = client._merge_metadata(None)

        assert result == {"parent": "value"}

    def test_entry_only_returns_entry(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        result = client._merge_metadata({"entry": "value"})

        assert result == {"entry": "value"}

    def test_both_merges_with_entry_priority(self, valid_config: LogwellConfig) -> None:
        mock_queue, _ = make_mock_queue()
        client = Logwell(
            valid_config,
            _queue=mock_queue,
            _parent_metadata={"key": "parent", "parent_only": "p"},
        )

        result = client._merge_metadata({"key": "entry", "entry_only": "e"})

        assert result == {"key": "entry", "parent_only": "p", "entry_only": "e"}


class TestIntegration:
    @pytest.mark.asyncio
    async def test_basic_workflow(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        client = Logwell(valid_config, _queue=mock_queue)

        client.info("Starting task")
        client.debug("Processing item", {"item_id": 1})
        client.info("Task complete")

        response = await client.flush()

        assert len(captured) == 3
        assert response == {"accepted": 1}

    @pytest.mark.asyncio
    async def test_request_scoped_logging(self, valid_api_key: str, valid_endpoint: str) -> None:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
            "service": "api-server",
        }
        mock_queue, captured = make_mock_queue()
        client = Logwell(config, _queue=mock_queue)

        request_logger = client.child({"request_id": "req-123", "method": "GET"})
        request_logger.info("Request received")

        user_logger = request_logger.child({"user_id": "user-456"})
        user_logger.info("Processing user request")
        user_logger.debug("Fetching data")

        request_logger.info("Request complete", {"status": 200})

        for entry in captured:
            assert entry["metadata"]["request_id"] == "req-123"
            assert entry["service"] == "api-server"

        assert captured[1]["metadata"]["user_id"] == "user-456"
        assert captured[2]["metadata"]["user_id"] == "user-456"

    @pytest.mark.asyncio
    async def test_graceful_shutdown(self, valid_config: LogwellConfig) -> None:
        mock_queue, captured = make_mock_queue()
        mock_transport = MagicMock()
        mock_transport.close = AsyncMock()

        with patch.object(Logwell, "__init__", lambda s, c: None):
            client = Logwell.__new__(Logwell)
            client._config = valid_config
            client._queue = mock_queue
            client._owns_queue = True
            client._stopped = False
            client._transport = mock_transport
            client._parent_metadata = None

        child1 = client.child({"worker": 1})
        child2 = client.child({"worker": 2})

        child1.info("Worker 1 log")
        child2.info("Worker 2 log")

        await child1.shutdown()
        await child2.shutdown()
        assert mock_queue.shutdown.call_count == 0

        await client.shutdown()
        assert mock_queue.shutdown.call_count == 1
