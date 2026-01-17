"""Error types for the Logwell Python SDK.

This module provides custom exception classes and error codes
for handling Logwell-specific errors.
"""

from __future__ import annotations

from enum import Enum


class LogwellErrorCode(str, Enum):
    """Error codes for Logwell SDK errors.

    Each code represents a specific category of error that can occur
    during SDK operations.
    """

    NETWORK_ERROR = "NETWORK_ERROR"
    """Network connectivity or timeout error."""

    UNAUTHORIZED = "UNAUTHORIZED"
    """Invalid or expired API key (401)."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    """Invalid request data or format."""

    RATE_LIMITED = "RATE_LIMITED"
    """Too many requests (429)."""

    SERVER_ERROR = "SERVER_ERROR"
    """Server-side error (5xx)."""

    QUEUE_OVERFLOW = "QUEUE_OVERFLOW"
    """Queue exceeded max size, logs dropped."""

    INVALID_CONFIG = "INVALID_CONFIG"
    """Invalid configuration value."""


class LogwellError(Exception):
    """Custom exception for Logwell SDK errors.

    Attributes:
        message: Human-readable error description
        code: Error category code
        status_code: HTTP status code if applicable
        retryable: Whether the operation can be retried
    """

    def __init__(
        self,
        message: str,
        code: LogwellErrorCode,
        status_code: int | None = None,
        retryable: bool = False,
    ) -> None:
        """Initialize a LogwellError.

        Args:
            message: Human-readable error description
            code: Error category code from LogwellErrorCode enum
            status_code: HTTP status code if applicable (default: None)
            retryable: Whether the operation can be retried (default: False)
        """
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.retryable = retryable

    def __str__(self) -> str:
        """Return string representation of the error."""
        parts = [f"[{self.code.value}] {self.message}"]
        if self.status_code is not None:
            parts.append(f" (HTTP {self.status_code})")
        return "".join(parts)

    def __repr__(self) -> str:
        """Return detailed representation of the error."""
        return (
            f"LogwellError("
            f"message={self.message!r}, "
            f"code={self.code!r}, "
            f"status_code={self.status_code!r}, "
            f"retryable={self.retryable!r})"
        )
