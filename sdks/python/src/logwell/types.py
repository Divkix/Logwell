"""Type definitions for the Logwell Python SDK.

This module provides type definitions for log entries, configuration,
and API responses using TypedDict for zero runtime overhead.
"""

from __future__ import annotations

from typing import Any, Callable, Literal

from typing_extensions import NotRequired, Required, TypedDict

LogLevel = Literal["debug", "info", "warn", "error", "fatal"]


class LogEntry(TypedDict, total=False):
    """A log entry to be sent to Logwell.

    Required fields:
        level: Log severity level
        message: Log message content

    Optional fields:
        timestamp: ISO8601 timestamp (auto-generated if not provided)
        service: Service name for this log
        metadata: Arbitrary key-value metadata
        source_file: Source file path where log was called
        line_number: Line number where log was called
    """

    level: Required[LogLevel]
    message: Required[str]
    timestamp: str
    service: str
    metadata: dict[str, Any]
    source_file: str
    line_number: int


class LogwellConfig(TypedDict, total=False):
    """Configuration for the Logwell client.

    Required fields:
        api_key: API key in format lw_[32 chars]
        endpoint: Logwell server endpoint URL

    Optional fields:
        service: Default service name for all logs
        batch_size: Number of logs to batch before auto-flush (default: 50)
        flush_interval: Seconds between auto-flushes (default: 5.0)
        max_queue_size: Maximum queue size before dropping oldest (default: 1000)
        max_retries: Maximum retry attempts for failed requests (default: 3)
        capture_source_location: Whether to capture file/line info (default: False)
        on_error: Callback function for errors
        on_flush: Callback function after successful flush with count of logs sent
    """

    api_key: Required[str]
    endpoint: Required[str]
    service: str
    batch_size: int
    flush_interval: float
    max_queue_size: int
    max_retries: int
    capture_source_location: bool
    on_error: Callable[[Exception], None]
    on_flush: Callable[[int], None]


class IngestResponse(TypedDict):
    """Response from the Logwell ingest API.

    Fields:
        accepted: Number of logs accepted
        rejected: Number of logs rejected (optional)
        errors: List of error messages (optional)
    """

    accepted: int
    rejected: NotRequired[int]
    errors: NotRequired[list[str]]
