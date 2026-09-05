from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from unittest.mock import MagicMock

import httpx
import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

    from logwell.types import IngestResponse, LogEntry, LogwellConfig


@pytest.fixture
def valid_api_key() -> str:
    return "lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


@pytest.fixture
def valid_endpoint() -> str:
    return "https://logs.example.com"


@pytest.fixture
def valid_config(valid_api_key: str, valid_endpoint: str) -> LogwellConfig:
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def valid_config_full(valid_api_key: str, valid_endpoint: str) -> LogwellConfig:
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
    return {
        "api_key": "lw_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "endpoint": "http://localhost:3000",
    }


@pytest.fixture
def invalid_config_missing_api_key(valid_endpoint: str) -> dict[str, Any]:
    return {
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_missing_endpoint(valid_api_key: str) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
    }


@pytest.fixture
def invalid_config_empty_api_key(valid_endpoint: str) -> dict[str, Any]:
    return {
        "api_key": "",
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_empty_endpoint(valid_api_key: str) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
        "endpoint": "",
    }


@pytest.fixture
def invalid_config_bad_api_key_format(valid_endpoint: str) -> dict[str, Any]:
    return {
        "api_key": "bad_key_format",
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_short_api_key(valid_endpoint: str) -> dict[str, Any]:
    return {
        "api_key": "lw_short",
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_long_api_key(valid_endpoint: str) -> dict[str, Any]:
    return {
        "api_key": "lw_" + "a" * 40,
        "endpoint": valid_endpoint,
    }


@pytest.fixture
def invalid_config_bad_endpoint_format(valid_api_key: str) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
        "endpoint": "logs.example.com",
    }


@pytest.fixture
def invalid_config_bad_endpoint_relative(valid_api_key: str) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
        "endpoint": "/api/logs",
    }


@pytest.fixture
def invalid_config_negative_batch_size(valid_api_key: str, valid_endpoint: str) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "batch_size": -1,
    }


@pytest.fixture
def invalid_config_zero_batch_size(valid_api_key: str, valid_endpoint: str) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "batch_size": 0,
    }


@pytest.fixture
def invalid_config_negative_flush_interval(
    valid_api_key: str, valid_endpoint: str
) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "flush_interval": -1.0,
    }


@pytest.fixture
def invalid_config_negative_max_queue_size(
    valid_api_key: str, valid_endpoint: str
) -> dict[str, Any]:
    return {
        "api_key": valid_api_key,
        "endpoint": valid_endpoint,
        "max_queue_size": -100,
    }


@pytest.fixture
def invalid_config_negative_max_retries(valid_api_key: str, valid_endpoint: str) -> dict[str, Any]:
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


@pytest.fixture
def mock_success_response() -> IngestResponse:
    return {
        "accepted": 10,
    }


@pytest.fixture
def mock_partial_success_response() -> IngestResponse:
    return {
        "accepted": 8,
        "rejected": 2,
        "errors": ["Invalid log format at index 3", "Missing timestamp at index 7"],
    }


@pytest.fixture
def mock_full_rejection_response() -> IngestResponse:
    return {
        "accepted": 0,
        "rejected": 10,
        "errors": ["All logs failed validation"],
    }


@pytest.fixture
def mock_httpx_success_response(mock_success_response: IngestResponse) -> httpx.Response:
    return httpx.Response(
        status_code=200,
        json=mock_success_response,
    )


@pytest.fixture
def mock_httpx_unauthorized_response() -> httpx.Response:
    return httpx.Response(
        status_code=401,
        json={"error": "Invalid API key"},
    )


@pytest.fixture
def mock_httpx_rate_limited_response() -> httpx.Response:
    return httpx.Response(
        status_code=429,
        json={"error": "Too many requests"},
        headers={"Retry-After": "60"},
    )


@pytest.fixture
def mock_httpx_server_error_response() -> httpx.Response:
    return httpx.Response(
        status_code=500,
        json={"error": "Internal server error"},
    )


@pytest.fixture
def mock_httpx_validation_error_response() -> httpx.Response:
    return httpx.Response(
        status_code=400,
        json={"error": "Validation failed", "details": ["Invalid log level"]},
    )


@pytest.fixture
def sample_log_entry() -> LogEntry:
    return {
        "level": "info",
        "message": "Test log message",
    }


@pytest.fixture
def sample_log_entry_full() -> LogEntry:
    return {
        "level": "error",
        "message": "Something went wrong",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "test-service",
        "metadata": {"user_id": "123", "request_id": "abc-def"},
        "sourceFile": "/app/main.py",
        "lineNumber": 42,
    }


@pytest.fixture
def sample_log_entries() -> list[LogEntry]:
    return [
        {"level": "debug", "message": "Debug message"},
        {"level": "info", "message": "Info message"},
        {"level": "warn", "message": "Warning message"},
        {"level": "error", "message": "Error message"},
        {"level": "fatal", "message": "Fatal message"},
    ]


@pytest.fixture
def sample_log_entry_with_metadata() -> LogEntry:
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


@pytest.fixture
def mock_on_error() -> MagicMock:
    return MagicMock()


@pytest.fixture
def mock_on_flush() -> MagicMock:
    return MagicMock()


@pytest.fixture
def capture_errors() -> tuple[list[Exception], Callable[[Exception], None]]:
    errors: list[Exception] = []

    def on_error(error: Exception) -> None:
        errors.append(error)

    return errors, on_error


@pytest.fixture
def capture_flushes() -> tuple[list[int], Callable[[int], None]]:
    counts: list[int] = []

    def on_flush(count: int) -> None:
        counts.append(count)

    return counts, on_flush


@pytest.fixture
def timestamp_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def make_log_entry() -> Callable[..., LogEntry]:

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

    def _make(**overrides: Any) -> LogwellConfig:
        config: LogwellConfig = {
            "api_key": valid_api_key,
            "endpoint": valid_endpoint,
        }
        config.update(overrides)  # type: ignore[typeddict-item]
        return config

    return _make
