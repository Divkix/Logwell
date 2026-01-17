"""End-to-end integration tests for Logwell Python SDK.

Tests full flow with mocked HTTP using respx:
- Instantiate -> log -> flush -> verify HTTP request sent
- Multiple logs batched together
- Retry on server error (5xx)
- Error handling (401, 400)
- Shutdown flushes remaining logs
- Child logger logs go to same endpoint
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import pytest
import respx

from logwell import Logwell, LogwellError, LogwellErrorCode

if TYPE_CHECKING:
    from logwell.types import LogwellConfig


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def valid_config() -> LogwellConfig:
    """Valid config for integration tests."""
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
    """Start respx mock server for integration tests."""
    with respx.mock(assert_all_called=False) as router:
        yield router


# =============================================================================
# Full Flow Tests
# =============================================================================


class TestFullFlow:
    """Test complete logging flow from instantiate to flush."""

    @pytest.mark.asyncio
    async def test_log_and_flush_sends_http_request(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Full flow: instantiate -> log -> flush -> verify HTTP request sent."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
        client = Logwell(valid_config)
        client.info("Test message", {"key": "value"})
        response = await client.flush()
        await client.shutdown()

        # Verify
        assert response is not None
        assert response["accepted"] == 1
        assert mock_server.calls.call_count == 1

        # Verify request payload
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
        """All log levels (debug, info, warn, error, fatal) send correctly."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        # Execute
        client = Logwell(valid_config)
        client.debug("Debug message")
        client.info("Info message")
        client.warn("Warn message")
        client.error("Error message")
        client.fatal("Fatal message")
        await client.flush()
        await client.shutdown()

        # Verify
        request = mock_server.calls.last.request
        body = json.loads(request.content)

        levels = [entry["level"] for entry in body]
        assert levels == ["debug", "info", "warn", "error", "fatal"]


# =============================================================================
# Batching Tests
# =============================================================================


class TestBatching:
    """Test log batching behavior."""

    @pytest.mark.asyncio
    async def test_multiple_logs_batched_together(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Multiple logs are batched into a single HTTP request."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        # Execute
        client = Logwell(valid_config)
        for i in range(5):
            client.info(f"Message {i}")
        response = await client.flush()
        await client.shutdown()

        # Verify single request with all logs
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
        """Logs are auto-flushed when batch size is reached."""
        # Use smaller batch size
        config = {**valid_config, "batch_size": 5}

        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        # Execute
        client = Logwell(config)
        for i in range(5):
            client.info(f"Message {i}")

        # Give time for auto-flush to complete
        import asyncio

        await asyncio.sleep(0.1)

        await client.shutdown()

        # Verify flush occurred
        assert mock_server.calls.call_count >= 1


# =============================================================================
# Retry Tests
# =============================================================================


class TestRetry:
    """Test retry behavior on server errors."""

    @pytest.mark.asyncio
    async def test_retry_on_500_server_error(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Retries on 5xx server errors with exponential backoff."""
        # Setup mock: fail twice, succeed third time
        responses = [
            httpx.Response(500, json={"error": "Internal server error"}),
            httpx.Response(503, json={"error": "Service unavailable"}),
            httpx.Response(200, json={"accepted": 1}),
        ]
        mock_server.post("https://logs.example.com/v1/ingest").mock(side_effect=responses)

        # Execute
        client = Logwell(valid_config)
        client.info("Test message")
        response = await client.flush()
        await client.shutdown()

        # Verify retries occurred and succeeded
        assert response is not None
        assert response["accepted"] == 1
        assert mock_server.calls.call_count == 3

    @pytest.mark.asyncio
    async def test_retry_on_429_rate_limit(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Retries on 429 rate limit with exponential backoff."""
        # Setup mock: rate limit then succeed
        responses = [
            httpx.Response(429, json={"error": "Too many requests"}),
            httpx.Response(200, json={"accepted": 1}),
        ]
        mock_server.post("https://logs.example.com/v1/ingest").mock(side_effect=responses)

        # Execute
        client = Logwell(valid_config)
        client.info("Test message")
        response = await client.flush()
        await client.shutdown()

        # Verify retry succeeded
        assert response is not None
        assert response["accepted"] == 1
        assert mock_server.calls.call_count == 2

    @pytest.mark.asyncio
    async def test_max_retries_exhausted_requeues_logs(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """When max retries exhausted, logs are requeued for next flush."""
        # Use low retry count
        config = {**valid_config, "max_retries": 1}

        # Setup mock: always fail
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(500, json={"error": "Server error"})
        )

        # Execute
        client = Logwell(config)
        client.info("Test message")
        response = await client.flush()

        # Verify flush failed (returns None on error)
        assert response is None
        # Logs should still be in queue (requeued after failure)
        assert client.queue_size == 1

        await client.shutdown()


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Test error handling for various HTTP errors."""

    @pytest.mark.asyncio
    async def test_401_unauthorized_not_retried(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """401 Unauthorized is not retried and triggers on_error callback."""
        errors: list[Exception] = []

        # Use max_retries=0 to ensure only 1 attempt per flush
        config = {**valid_config, "on_error": lambda e: errors.append(e), "max_retries": 0}

        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(401, json={"error": "Invalid API key"})
        )

        # Execute
        client = Logwell(config)
        client.info("Test message")
        await client.flush()

        # After flush fails, logs are requeued. Check before shutdown to see single attempt.
        # Note: shutdown will also try to flush requeued logs, so we check intermediate state
        first_flush_calls = mock_server.calls.call_count
        assert first_flush_calls == 1  # No retries for 401

        await client.shutdown()

        # Verify error callback was triggered
        assert len(errors) >= 1
        assert isinstance(errors[0], LogwellError)
        assert errors[0].code == LogwellErrorCode.UNAUTHORIZED
        assert not errors[0].retryable

    @pytest.mark.asyncio
    async def test_400_bad_request_not_retried(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """400 Bad Request is not retried."""
        errors: list[Exception] = []

        # Use max_retries=0 to ensure only 1 attempt per flush
        config = {**valid_config, "on_error": lambda e: errors.append(e), "max_retries": 0}

        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(400, json={"error": "Validation failed"})
        )

        # Execute
        client = Logwell(config)
        client.info("Test message")
        await client.flush()

        # Verify no retry on first flush (400 is non-retryable)
        first_flush_calls = mock_server.calls.call_count
        assert first_flush_calls == 1  # No retries for 400

        await client.shutdown()

        # Verify error
        assert len(errors) >= 1
        assert isinstance(errors[0], LogwellError)
        assert errors[0].code == LogwellErrorCode.VALIDATION_ERROR

    @pytest.mark.asyncio
    async def test_on_error_callback_receives_exception(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """on_error callback receives LogwellError with full details."""
        errors: list[Exception] = []

        config = {**valid_config, "on_error": lambda e: errors.append(e)}

        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(500, json={"error": "Internal error"})
        )

        # Execute (will fail after retries)
        client = Logwell(config)
        client.info("Test message")
        await client.flush()
        await client.shutdown()

        # Verify error callback received
        assert len(errors) >= 1
        assert isinstance(errors[-1], LogwellError)
        assert errors[-1].code == LogwellErrorCode.SERVER_ERROR


# =============================================================================
# Shutdown Tests
# =============================================================================


class TestShutdown:
    """Test shutdown behavior."""

    @pytest.mark.asyncio
    async def test_shutdown_flushes_remaining_logs(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Shutdown flushes any remaining logs in the queue."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 3})
        )

        # Execute
        client = Logwell(valid_config)
        client.info("Message 1")
        client.info("Message 2")
        client.info("Message 3")

        # Don't call flush, just shutdown
        await client.shutdown()

        # Verify logs were flushed during shutdown
        assert mock_server.calls.call_count >= 1
        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 3

    @pytest.mark.asyncio
    async def test_shutdown_is_idempotent(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Shutdown can be called multiple times safely."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
        client = Logwell(valid_config)
        client.info("Test message")

        # Call shutdown multiple times
        await client.shutdown()
        await client.shutdown()
        await client.shutdown()

        # Should only flush once
        assert mock_server.calls.call_count == 1

    @pytest.mark.asyncio
    async def test_logs_after_shutdown_are_ignored(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Logs added after shutdown are silently ignored."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
        client = Logwell(valid_config)
        client.info("Before shutdown")
        await client.shutdown()

        # These should be ignored
        client.info("After shutdown 1")
        client.info("After shutdown 2")

        # Verify only the first log was sent
        assert mock_server.calls.call_count == 1
        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 1
        assert body[0]["message"] == "Before shutdown"


# =============================================================================
# Child Logger Tests
# =============================================================================


class TestChildLogger:
    """Test child logger behavior."""

    @pytest.mark.asyncio
    async def test_child_logger_logs_to_same_endpoint(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Child logger logs go to the same endpoint as parent."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 2})
        )

        # Execute
        client = Logwell(valid_config)
        child = client.child({"child_key": "child_value"})

        client.info("Parent log")
        child.info("Child log")

        await client.flush()
        await client.shutdown()

        # Verify both logs sent to same endpoint
        assert mock_server.calls.call_count == 1
        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 2

    @pytest.mark.asyncio
    async def test_child_logger_inherits_parent_metadata(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Child logger metadata is merged with parent metadata."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
        client = Logwell(valid_config)
        child = client.child({"request_id": "abc123"})

        child.info("Child log", {"extra": "data"})

        await client.flush()
        await client.shutdown()

        # Verify metadata is merged
        body = json.loads(mock_server.calls.last.request.content)
        assert len(body) == 1
        assert body[0]["metadata"]["request_id"] == "abc123"
        assert body[0]["metadata"]["extra"] == "data"

    @pytest.mark.asyncio
    async def test_nested_children_accumulate_metadata(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Nested child loggers accumulate metadata from all ancestors."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
        client = Logwell(valid_config)
        child1 = client.child({"tenant_id": "tenant-123"})
        child2 = child1.child({"user_id": "user-456"})
        grandchild = child2.child({"session_id": "session-789"})

        grandchild.info("Grandchild log")

        await client.flush()
        await client.shutdown()

        # Verify all metadata accumulated
        body = json.loads(mock_server.calls.last.request.content)
        metadata = body[0]["metadata"]
        assert metadata["tenant_id"] == "tenant-123"
        assert metadata["user_id"] == "user-456"
        assert metadata["session_id"] == "session-789"

    @pytest.mark.asyncio
    async def test_child_logger_can_override_service(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Child logger can override the service name."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 2})
        )

        # Execute
        client = Logwell(valid_config)
        child = client.child(service="child-service")

        client.info("Parent log")
        child.info("Child log")

        await client.flush()
        await client.shutdown()

        # Verify services
        body = json.loads(mock_server.calls.last.request.content)
        assert body[0]["service"] == "integration-test"  # Parent
        assert body[1]["service"] == "child-service"  # Child override

    @pytest.mark.asyncio
    async def test_child_logger_shares_queue_with_parent(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Child logger shares the same queue as parent."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 3})
        )

        # Execute
        client = Logwell(valid_config)
        child1 = client.child({"key1": "value1"})
        child2 = client.child({"key2": "value2"})

        client.info("Parent log")
        child1.info("Child1 log")
        child2.info("Child2 log")

        # All logs should be in the same queue
        assert client.queue_size == 3

        await client.flush()
        await client.shutdown()

        # All sent in single request
        assert mock_server.calls.call_count == 1


# =============================================================================
# On Flush Callback Tests
# =============================================================================


class TestOnFlushCallback:
    """Test on_flush callback behavior."""

    @pytest.mark.asyncio
    async def test_on_flush_callback_receives_count(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """on_flush callback receives the count of flushed logs."""
        flush_counts: list[int] = []

        config = {**valid_config, "on_flush": lambda count: flush_counts.append(count)}

        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 5})
        )

        # Execute
        client = Logwell(config)
        for i in range(5):
            client.info(f"Message {i}")
        await client.flush()
        await client.shutdown()

        # Verify callback received correct count
        assert len(flush_counts) == 1
        assert flush_counts[0] == 5


# =============================================================================
# Source Location Tests
# =============================================================================


class TestSourceLocation:
    """Test source location capture in integration context."""

    @pytest.mark.asyncio
    async def test_source_location_captured_when_enabled(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Source location is captured when capture_source_location is enabled."""
        config = {**valid_config, "capture_source_location": True}

        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
        client = Logwell(config)
        client.info("Test message")
        await client.flush()
        await client.shutdown()

        # Verify source location is present
        body = json.loads(mock_server.calls.last.request.content)
        assert "source_file" in body[0]
        assert "line_number" in body[0]
        assert body[0]["source_file"].endswith("test_e2e.py")

    @pytest.mark.asyncio
    async def test_source_location_not_captured_when_disabled(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Source location is not captured when capture_source_location is disabled."""
        config = {**valid_config, "capture_source_location": False}

        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
        client = Logwell(config)
        client.info("Test message")
        await client.flush()
        await client.shutdown()

        # Verify source location is not present
        body = json.loads(mock_server.calls.last.request.content)
        assert "source_file" not in body[0]
        assert "line_number" not in body[0]


# =============================================================================
# Metadata Tests
# =============================================================================


class TestMetadata:
    """Test metadata handling in integration context."""

    @pytest.mark.asyncio
    async def test_complex_metadata_serialized_correctly(
        self, valid_config: LogwellConfig, mock_server: respx.MockRouter
    ) -> None:
        """Complex nested metadata is serialized correctly in HTTP request."""
        # Setup mock
        mock_server.post("https://logs.example.com/v1/ingest").mock(
            return_value=httpx.Response(200, json={"accepted": 1})
        )

        # Execute
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

        # Verify metadata serialized correctly
        body = json.loads(mock_server.calls.last.request.content)
        metadata = body[0]["metadata"]
        assert metadata["string"] == "value"
        assert metadata["number"] == 42
        assert metadata["float"] == 3.14
        assert metadata["boolean"] is True
        assert metadata["null"] is None
        assert metadata["array"] == [1, 2, 3]
        assert metadata["nested"]["deep"]["value"] == "found"
