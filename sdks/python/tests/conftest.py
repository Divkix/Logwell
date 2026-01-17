"""Pytest fixtures for Logwell SDK tests.

Provides reusable fixtures for:
- Valid/invalid configurations
- Mock HTTP responses
- Sample log entries
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from unittest.mock import MagicMock

import httpx
import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

    from logwell.types import IngestResponse, LogEntry, LogwellConfig


# =============================================================================
# Valid Configurations
# =============================================================================


@pytest.fixture
def valid_api_key() -> str:
    """A valid API key in lw_[32 chars] format."""
    return "lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


@pytest.fixture
def valid_endpoint() -> str:
    """A valid HTTPS endpoint URL."""
    return "https://logs.example.com"


@pytest.fixture
def valid_config(valid_api_key: str, valid_endpoint: str) -> LogwellConfig:
    """Minimal valid configuration with required fields only."""
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def valid_config_full(valid_api_key: str, valid_endpoint: str) -> LogwellConfig:
    """Complete valid configuration with all fields."""
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "service": "test-service",
        "batch_size": 100,
        "flush_interval": 10.0,
        "max_queue_size": 500,
        "max_retries": 5,
        "capture_source_location": True,
    }


@pytest.fixture
def valid_config_localhost() -> LogwellConfig:
    """Valid config with localhost endpoint (for local testing)."""
    return {
        "api_key": "lw_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "endpoint": "http://localhost:3000",
    }


# =============================================================================
# Invalid Configurations
# =============================================================================


@pytest.fixture
def invalid_config_missing_api_key(valid_endpoint: str) -> dict[str, Any]:
    """Config missing required api_key field."""
    return {
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_missing_endpoint(valid_api_key: str) -> dict[str, Any]:
    """Config missing required endpoint field."""
    return {
        "api_key": valid_api_key,
    }


@pytest.fixture
def invalid_config_empty_api_key(valid_endpoint: str) -> dict[str, Any]:
    """Config with empty api_key string."""
    return {
        "api_key": "",
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_empty_endpoint(valid_api_key: str) -> dict[str, Any]:
    """Config with empty endpoint string."""
    return {
        "api_key": valid_api_key,
        "endpoint": "",
    }


@pytest.fixture
def invalid_config_bad_api_key_format(valid_endpoint: str) -> dict[str, Any]:
    """Config with malformed API key (wrong prefix)."""
    return {
        "api_key": "bad_key_format",
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_short_api_key(valid_endpoint: str) -> dict[str, Any]:
    """Config with API key too short."""
    return {
        "api_key": "lw_short",
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_long_api_key(valid_endpoint: str) -> dict[str, Any]:
    """Config with API key too long."""
    return {
        "api_key": "lw_" + "a" * 40,
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_bad_endpoint_format(valid_api_key: str) -> dict[str, Any]:
    """Config with malformed endpoint URL (missing scheme)."""
    return {
        "api_key": valid_api_key,
        "endpoint": "logs.example.com",
    }


@pytest.fixture
def invalid_config_bad_endpoint_relative(valid_api_key: str) -> dict[str, Any]:
    """Config with relative endpoint path."""
    return {
        "api_key": valid_api_key,
        "endpoint": "/api/logs",
    }


@pytest.fixture
def invalid_config_negative_batch_size(valid_api_key: str, valid_endpoint: str) -> dict[str, Any]:
    """Config with negative batch_size."""
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "batch_size": -1,
    }


@pytest.fixture
def invalid_config_zero_batch_size(valid_api_key: str, valid_endpoint: str) -> dict[str, Any]:
    """Config with zero batch_size."""
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "batch_size": 0,
    }


@pytest.fixture
def invalid_config_negative_flush_interval(
    valid_api_key: str, valid_endpoint: str
) -> dict[str, Any]:
    """Config with negative flush_interval."""
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "flush_interval": -1.0,
    }


@pytest.fixture
def invalid_config_negative_max_queue_size(
    valid_api_key: str, valid_endpoint: str
) -> dict[str, Any]:
    """Config with negative max_queue_size."""
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "max_queue_size": -100,
    }


@pytest.fixture
def invalid_config_negative_max_retries(valid_api_key: str, valid_endpoint: str) -> dict[str, Any]:
    """Config with negative max_retries."""
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "max_retries": -1,
    }


@pytest.fixture
def invalid_configs(
    invalid_config_missing_api_key: dict[str, Any],
    invalid_config_missing_endpoint: dict[str, Any],
    invalid_config_empty_api_key: dict[str, Any],
    invalid_config_empty_endpoint: dict[str, Any],
    invalid_config_bad_api_key_format: dict[str, Any],
    invalid_config_short_api_key: dict[str, Any],
    invalid_config_long_api_key: dict[str, Any],
    invalid_config_bad_endpoint_format: dict[str, Any],
    invalid_config_negative_batch_size: dict[str, Any],
    invalid_config_zero_batch_size: dict[str, Any],
    invalid_config_negative_flush_interval: dict[str, Any],
    invalid_config_negative_max_queue_size: dict[str, Any],
    invalid_config_negative_max_retries: dict[str, Any],
) -> list[dict[str, Any]]:
    """Collection of all invalid configurations for parametrized tests."""
    return [
        invalid_config_missing_api_key,
        invalid_config_missing_endpoint,
        invalid_config_empty_api_key,
        invalid_config_empty_endpoint,
        invalid_config_bad_api_key_format,
        invalid_config_short_api_key,
        invalid_config_long_api_key,
        invalid_config_bad_endpoint_format,
        invalid_config_negative_batch_size,
        invalid_config_zero_batch_size,
        invalid_config_negative_flush_interval,
        invalid_config_negative_max_queue_size,
        invalid_config_negative_max_retries,
    ]


# =============================================================================
# Mock HTTP Responses
# =============================================================================


@pytest.fixture
def mock_success_response() -> IngestResponse:
    """Successful ingest API response."""
    return {
        "accepted": 10,
    }


@pytest.fixture
def mock_partial_success_response() -> IngestResponse:
    """Partial success response with some rejections."""
    return {
        "accepted": 8,
        "rejected": 2,
        "errors": ["Invalid log format at index 3", "Missing timestamp at index 7"],
    }


@pytest.fixture
def mock_full_rejection_response() -> IngestResponse:
    """Response where all logs were rejected."""
    return {
        "accepted": 0,
        "rejected": 10,
        "errors": ["All logs failed validation"],
    }


@pytest.fixture
def mock_httpx_success_response(mock_success_response: IngestResponse) -> httpx.Response:
    """Mock httpx.Response for successful request."""
    return httpx.Response(
        status_code=200,
        json=mock_success_response,
    )


@pytest.fixture
def mock_httpx_unauthorized_response() -> httpx.Response:
    """Mock httpx.Response for 401 Unauthorized."""
    return httpx.Response(
        status_code=401,
        json={"error": "Invalid API key"},
    )


@pytest.fixture
def mock_httpx_rate_limited_response() -> httpx.Response:
    """Mock httpx.Response for 429 Rate Limited."""
    return httpx.Response(
        status_code=429,
        json={"error": "Too many requests"},
        headers={"Retry-After": "60"},
    )


@pytest.fixture
def mock_httpx_server_error_response() -> httpx.Response:
    """Mock httpx.Response for 500 Server Error."""
    return httpx.Response(
        status_code=500,
        json={"error": "Internal server error"},
    )


@pytest.fixture
def mock_httpx_validation_error_response() -> httpx.Response:
    """Mock httpx.Response for 400 Bad Request."""
    return httpx.Response(
        status_code=400,
        json={"error": "Validation failed", "details": ["Invalid log level"]},
    )


# =============================================================================
# Sample Log Entries
# =============================================================================


@pytest.fixture
def sample_log_entry() -> LogEntry:
    """A minimal valid log entry."""
    return {
        "level": "info",
        "message": "Test log message",
    }


@pytest.fixture
def sample_log_entry_full() -> LogEntry:
    """A complete log entry with all fields populated."""
    return {
        "level": "error",
        "message": "Something went wrong",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "test-service",
        "metadata": {"user_id": "123", "request_id": "abc-def"},
        "source_file": "/app/main.py",
        "line_number": 42,
    }


@pytest.fixture
def sample_log_entries() -> list[LogEntry]:
    """A batch of varied log entries."""
    return [
        {"level": "debug", "message": "Debug message"},
        {"level": "info", "message": "Info message"},
        {"level": "warn", "message": "Warning message"},
        {"level": "error", "message": "Error message"},
        {"level": "fatal", "message": "Fatal message"},
    ]


@pytest.fixture
def sample_log_entry_with_metadata() -> LogEntry:
    """Log entry with complex metadata."""
    return {
        "level": "info",
        "message": "User action",
        "metadata": {
            "user_id": 12345,
            "action": "login",
            "ip_address": "192.168.1.1",
            "nested": {"key": "value"},
        },
    }


# =============================================================================
# Callback Fixtures
# =============================================================================


@pytest.fixture
def mock_on_error() -> MagicMock:
    """Mock on_error callback for testing error handling."""
    return MagicMock()


@pytest.fixture
def mock_on_flush() -> MagicMock:
    """Mock on_flush callback for testing flush events."""
    return MagicMock()


@pytest.fixture
def capture_errors() -> tuple[list[Exception], Callable[[Exception], None]]:
    """Capture errors in a list for assertions.

    Returns:
        Tuple of (error_list, callback_function)
    """
    errors: list[Exception] = []

    def on_error(error: Exception) -> None:
        errors.append(error)

    return errors, on_error


@pytest.fixture
def capture_flushes() -> tuple[list[int], Callable[[int], None]]:
    """Capture flush counts in a list for assertions.

    Returns:
        Tuple of (count_list, callback_function)
    """
    counts: list[int] = []

    def on_flush(count: int) -> None:
        counts.append(count)

    return counts, on_flush


# =============================================================================
# Test Helpers
# =============================================================================


@pytest.fixture
def timestamp_now() -> str:
    """Current UTC timestamp in ISO format."""
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def make_log_entry() -> Callable[..., LogEntry]:
    """Factory fixture for creating log entries with custom fields."""

    def _make(
        level: str = "info",
        message: str = "test message",
        **kwargs: Any,
    ) -> LogEntry:
        entry: LogEntry = {
            "level": level,  # type: ignore[typeddict-item]
            "message": message,
        }
        entry.update(kwargs)  # type: ignore[typeddict-item]
        return entry

    return _make


@pytest.fixture
def make_config(valid_api_key: str, valid_endpoint: str) -> Callable[..., LogwellConfig]:
    """Factory fixture for creating configs with custom overrides."""

    def _make(**overrides: Any) -> LogwellConfig:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
        }
        config.update(overrides)  # type: ignore[typeddict-item]
        return config

    return _make
