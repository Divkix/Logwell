from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import pytest
import respx

from logwell import Logwell, LogwellError, LogwellErrorCode

if TYPE_CHECKING:
    from logwell.types import LogwellConfig


@pytest.fixture
def valid_config() -> LogwellConfig:
    return {
        "api_key": "lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "endpoint": "https://logs.example.com",
        "service": "integration-test",
        "batch_size": 10,
        "flush_interval": 1.0,
        "max_retries": 3,
    }


@pytest.fixture
def mock_server() -> respx.MockRouter:
    with respx.mock(assert_all_called=False) as router:
        yield router


class TestFullFlow:
    @pytest.mark.asyncio
    async def test_log_and_flush_sends_http_request(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(valid_config)
        client.info("Test message", {"key": "value"})
        response = await client.flush()
        await client.shutdown()

        assert response is not None
        assert response["accepted"] == 1
        assert mock_server.calls.call_count == 1

        request = mock_server.calls.last.request
        assert request.headers["Authorization"] == "Bearer lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        assert request.headers["Content-Type"] == "application/json"

        body = json.loads(request.content)
        assert len(body) == 1
        assert body[0]["level"] == "info"
        assert body[0]["message"] == "Test message"
        assert body[0]["metadata"]["key"] == "value"
        assert body[0]["service"] == "integration-test"
        assert "timestamp" in body[0]

    @pytest.mark.asyncio
    async def test_all_log_levels_send_correct_level(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        client = Logwell(valid_config)
        client.debug("Debug message")
        client.info("Info message")
        client.warn("Warn message")
        client.error("Error message")
        client.fatal("Fatal message")
        await client.flush()
        await client.shutdown()

        request = mock_server.calls.last.request
        body = json.loads(request.content)

        levels = [entry["level"] for entry in body]
        assert levels == ["debug", "info", "warn", "error", "fatal"]


class TestBatching:
    @pytest.mark.asyncio
    async def test_multiple_logs_batched_together(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        client = Logwell(valid_config)
        for i in range(5):
            client.info(f"Message {i}")
        response = await client.flush()
        await client.shutdown()

        assert response is not None
        assert response["accepted"] == 5
        assert mock_server.calls.call_count == 1

        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 5
        messages = [entry["message"] for entry in body]
        assert messages == [f"Message {i}" for i in range(5)]

    @pytest.mark.asyncio
    async def test_auto_flush_on_batch_size(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        config = {**valid_config, "batch_size": 5}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        client = Logwell(config)
        for i in range(5):
            client.info(f"Message {i}")

        import asyncio

        await asyncio.sleep(0.1)

        await client.shutdown()

        assert mock_server.calls.call_count >= 1


class TestRetry:
    @pytest.mark.asyncio
    async def test_retry_on_500_server_error(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        responses = [
            httpx.Response(500, json={"error": "Internal server error"}),
            httpx.Response(503, json={"error": "Service unavailable"}),
            httpx.Response(200, json={"accepted": 1}),
        ]
        mock_server.post("https://logs.example.com/v1/ingest").mock(side_effect=responses)

        client = Logwell(valid_config)
        client.info("Test message")
        response = await client.flush()
        await client.shutdown()

        assert response is not None
        assert response["accepted"] == 1
        assert mock_server.calls.call_count == 3

    @pytest.mark.asyncio
    async def test_retry_on_429_rate_limit(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        responses = [
            httpx.Response(429, json={"error": "Too many requests"}),
            httpx.Response(200, json={"accepted": 1}),
        ]
        mock_server.post("https://logs.example.com/v1/ingest").mock(side_effect=responses)

        client = Logwell(valid_config)
        client.info("Test message")
        response = await client.flush()
        await client.shutdown()

        assert response is not None
        assert response["accepted"] == 1
        assert mock_server.calls.call_count == 2

    @pytest.mark.asyncio
    async def test_max_retries_exhausted_requeues_logs(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        config = {**valid_config, "max_retries": 1}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(500, json={"error": "Server error"})
        )

        client = Logwell(config)
        client.info("Test message")
        response = await client.flush()

        assert response is None
        assert client.queue_size == 1

        await client.shutdown()


class TestErrorHandling:
    @pytest.mark.asyncio
    async def test_401_unauthorized_not_retried(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        errors: list[Exception] = []

        config = {**valid_config, "on_error": lambda e: errors.append(e), "max_retries": 0}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(401, json={"error": "Invalid API key"})
        )

        client = Logwell(config)
        client.info("Test message")
        await client.flush()

        first_flush_calls = mock_server.calls.call_count
        assert first_flush_calls == 1  # No retries for 401

        await client.shutdown()

        assert len(errors) >= 1
        assert isinstance(errors[0], LogwellError)
        assert errors[0].code == LogwellErrorCode.UNAUTHORIZED
        assert not errors[0].retryable

    @pytest.mark.asyncio
    async def test_400_bad_request_not_retried(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        errors: list[Exception] = []

        config = {**valid_config, "on_error": lambda e: errors.append(e), "max_retries": 0}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(400, json={"error": "Validation failed"})
        )

        client = Logwell(config)
        client.info("Test message")
        await client.flush()

        first_flush_calls = mock_server.calls.call_count
        assert first_flush_calls == 1  # No retries for 400

        await client.shutdown()

        assert len(errors) >= 1
        assert isinstance(errors[0], LogwellError)
        assert errors[0].code == LogwellErrorCode.VALIDATION_ERROR

    @pytest.mark.asyncio
    async def test_on_error_callback_receives_exception(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        errors: list[Exception] = []

        config = {**valid_config, "on_error": lambda e: errors.append(e)}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(500, json={"error": "Internal error"})
        )

        client = Logwell(config)
        client.info("Test message")
        await client.flush()
        await client.shutdown()

        assert len(errors) >= 1
        assert isinstance(errors[-1], LogwellError)
        assert errors[-1].code == LogwellErrorCode.SERVER_ERROR


class TestShutdown:
    @pytest.mark.asyncio
    async def test_shutdown_flushes_remaining_logs(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 3})
        )

        client = Logwell(valid_config)
        client.info("Message 1")
        client.info("Message 2")
        client.info("Message 3")

        await client.shutdown()

        assert mock_server.calls.call_count >= 1
        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 3

    @pytest.mark.asyncio
    async def test_shutdown_is_idempotent(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(valid_config)
        client.info("Test message")

        await client.shutdown()
        await client.shutdown()
        await client.shutdown()

        assert mock_server.calls.call_count == 1

    @pytest.mark.asyncio
    async def test_logs_after_shutdown_are_ignored(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(valid_config)
        client.info("Before shutdown")
        await client.shutdown()

        client.info("After shutdown 1")
        client.info("After shutdown 2")

        assert mock_server.calls.call_count == 1
        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 1
        assert body[0]["message"] == "Before shutdown"


class TestChildLogger:
    @pytest.mark.asyncio
    async def test_child_logger_logs_to_same_endpoint(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 2})
        )

        client = Logwell(valid_config)
        child = client.child({"child_key": "child_value"})

        client.info("Parent log")
        child.info("Child log")

        await client.flush()
        await client.shutdown()

        assert mock_server.calls.call_count == 1
        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 2

    @pytest.mark.asyncio
    async def test_child_logger_inherits_parent_metadata(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(valid_config)
        child = client.child({"request_id": "abc123"})

        child.info("Child log", {"extra": "data"})

        await client.flush()
        await client.shutdown()

        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 1
        assert body[0]["metadata"]["request_id"] == "abc123"
        assert body[0]["metadata"]["extra"] == "data"

    @pytest.mark.asyncio
    async def test_nested_children_accumulate_metadata(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(valid_config)
        child1 = client.child({"tenant_id": "tenant-123"})
        child2 = child1.child({"user_id": "user-456"})
        grandchild = child2.child({"session_id": "session-789"})

        grandchild.info("Grandchild log")

        await client.flush()
        await client.shutdown()

        body = json.loads(mock_server.calls.last.request.content)
        metadata = body[0]["metadata"]
        assert metadata["tenant_id"] == "tenant-123"
        assert metadata["user_id"] == "user-456"
        assert metadata["session_id"] == "session-789"

    @pytest.mark.asyncio
    async def test_child_logger_can_override_service(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 2})
        )

        client = Logwell(valid_config)
        child = client.child(service="child-service")

        client.info("Parent log")
        child.info("Child log")

        await client.flush()
        await client.shutdown()

        body = json.loads(mock_server.calls.last.request.content)
        assert body[0]["service"] == "integration-test"  # Parent
        assert body[1]["service"] == "child-service"  # Child override

    @pytest.mark.asyncio
    async def test_child_logger_shares_queue_with_parent(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 3})
        )

        client = Logwell(valid_config)
        child1 = client.child({"key1": "value1"})
        child2 = client.child({"key2": "value2"})

        client.info("Parent log")
        child1.info("Child1 log")
        child2.info("Child2 log")

        assert client.queue_size == 3

        await client.flush()
        await client.shutdown()

        assert mock_server.calls.call_count == 1


class TestOnFlushCallback:
    @pytest.mark.asyncio
    async def test_on_flush_callback_receives_count(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        flush_counts: list[int] = []

        config = {**valid_config, "on_flush": lambda count: flush_counts.append(count)}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        client = Logwell(config)
        for i in range(5):
            client.info(f"Message {i}")
        await client.flush()
        await client.shutdown()

        assert len(flush_counts) == 1
        assert flush_counts[0] == 5


class TestSourceLocation:
    @pytest.mark.asyncio
    async def test_source_location_captured_when_enabled(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        config = {**valid_config, "capture_source_location": True}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(config)
        client.info("Test message")
        await client.flush()
        await client.shutdown()

        body = json.loads(mock_server.calls.last.request.content)
        assert "sourceFile" in body[0]
        assert "lineNumber" in body[0]
        assert body[0]["sourceFile"].endswith("test_e2e.py")

    @pytest.mark.asyncio
    async def test_source_location_not_captured_when_disabled(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        config = {**valid_config, "capture_source_location": False}

        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(config)
        client.info("Test message")
        await client.flush()
        await client.shutdown()

        body = json.loads(mock_server.calls.last.request.content)
        assert "sourceFile" not in body[0]
        assert "lineNumber" not in body[0]


class TestMetadata:
    @pytest.mark.asyncio
    async def test_complex_metadata_serialized_correctly(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        client = Logwell(valid_config)
        client.info(
            "Test message",
            {
                "string": "value",
                "number": 42,
                "float": 3.14,
                "boolean": True,
                "null": None,
                "array": [1, 2, 3],
                "nested": {"deep": {"value": "found"}},
            },
        )
        await client.flush()
        await client.shutdown()

        body = json.loads(mock_server.calls.last.request.content)
        metadata = body[0]["metadata"]
        assert metadata["string"] == "value"
        assert metadata["number"] == 42
        assert metadata["float"] == 3.14
        assert metadata["boolean"] is True
        assert metadata["null"] is None
        assert metadata["array"] == [1, 2, 3]
        assert metadata["nested"]["deep"]["value"] == "found"
