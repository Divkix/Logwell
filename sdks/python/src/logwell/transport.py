"""HTTP transport for the Logwell Python SDK.

This module provides the HttpTransport class for sending log batches
to the Logwell server with retry logic and exponential backoff.
"""

from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING, Any

import httpx

from logwell.errors import LogwellError, LogwellErrorCode

if TYPE_CHECKING:
    from logwell.types import IngestResponse, LogEntry, LogwellConfig


class TransportConfig:
    """Configuration for HTTP transport.

    Attributes:
        endpoint: Logwell server endpoint URL
        api_key: API key for authentication
        max_retries: Maximum number of retry attempts
        timeout: Request timeout in seconds (default: 30)
    """

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        max_retries: int = 3,
        timeout: float = 30.0,
    ) -> None:
        self.endpoint = endpoint
        self.api_key = api_key
        self.max_retries = max_retries
        self.timeout = timeout

    @classmethod
    def from_logwell_config(cls, config: LogwellConfig) -> TransportConfig:
        """Create TransportConfig from LogwellConfig."""
        return cls(
            endpoint=config["endpoint"],
            api_key=config["api_key"],
            max_retries=config.get("max_retries", 3),
        )


async def _delay(attempt: int, base_delay: float = 0.1) -> None:
    """Delay with exponential backoff and jitter.

    Args:
        attempt: Current attempt number (0-indexed)
        base_delay: Base delay in seconds (default: 100ms)

    Formula: min(base_delay * 2^attempt, 10) + 30% jitter
    """
    delay_secs = min(base_delay * (2**attempt), 10.0)
    jitter = random.random() * delay_secs * 0.3
    await asyncio.sleep(delay_secs + jitter)


class HttpTransport:
    """HTTP transport for sending logs to Logwell server.

    Features:
    - Automatic retry with exponential backoff
    - Error classification with retryable flag
    - Proper error handling for all HTTP status codes
    """

    def __init__(self, config: LogwellConfig | TransportConfig) -> None:
        """Initialize the HTTP transport.

        Args:
            config: Either a LogwellConfig or TransportConfig
        """
        if isinstance(config, TransportConfig):
            self._config = config
        else:
            self._config = TransportConfig.from_logwell_config(config)

        self._ingest_url = f"{self._config.endpoint}/v1/ingest"
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._config.timeout)
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def send(self, logs: list[LogEntry]) -> IngestResponse:
        """Send logs to the Logwell server.

        Args:
            logs: Array of log entries to send

        Returns:
            Response with accepted/rejected counts

        Raises:
            LogwellError: On failure after all retries
        """
        last_error: LogwellError = LogwellError(
            f"Failed to send logs after {self._config.max_retries + 1} attempts "
            f"to {self._ingest_url}. Check your network connection and endpoint URL.",
            LogwellErrorCode.NETWORK_ERROR,
            None,
            True,
        )

        for attempt in range(self._config.max_retries + 1):
            try:
                return await self._do_request(logs)
            except LogwellError as error:
                last_error = error

                # Don't retry non-retryable errors
                if not error.retryable:
                    raise

                # Don't delay after the last attempt
                if attempt < self._config.max_retries:
                    await _delay(attempt)

        raise last_error

    async def _do_request(self, logs: list[LogEntry]) -> IngestResponse:
        """Execute the HTTP request.

        Args:
            logs: Array of log entries to send

        Returns:
            Parsed IngestResponse

        Raises:
            LogwellError: On network or HTTP errors
        """
        client = await self._get_client()

        try:
            response = await client.post(
                self._ingest_url,
                headers={
                    "Authorization": f"Bearer {self._config.api_key}",
                    "Content-Type": "application/json",
                },
                json=logs,
            )
        except httpx.TimeoutException as e:
            raise LogwellError(
                f"Request to {self._ingest_url} timed out after {self._config.timeout}s. "
                f"The server may be slow or unreachable. Error: {e}",
                LogwellErrorCode.NETWORK_ERROR,
                None,
                True,
            ) from e
        except httpx.RequestError as e:
            raise LogwellError(
                f"Network error connecting to {self._ingest_url}. "
                f"Check your internet connection and that the endpoint is reachable. Error: {e}",
                LogwellErrorCode.NETWORK_ERROR,
                None,
                True,
            ) from e

        # Handle error responses
        if not response.is_success:
            error_body = self._try_parse_error(response)
            raise self._create_error(response.status_code, error_body)

        # Parse successful response
        data: IngestResponse = response.json()
        return data

    def _try_parse_error(self, response: httpx.Response) -> str:
        """Try to parse error message from response body.

        Args:
            response: HTTP response

        Returns:
            Error message string
        """
        try:
            body: dict[str, Any] = response.json()
            return body.get("message") or body.get("error") or "Unknown error"
        except Exception:
            return f"HTTP {response.status_code}"

    def _create_error(self, status: int, message: str) -> LogwellError:
        """Create appropriate LogwellError based on status code.

        Args:
            status: HTTP status code
            message: Error message

        Returns:
            LogwellError with appropriate code and retryable flag
        """
        if status == 401:
            return LogwellError(
                f"Authentication failed (401): {message}. "
                "Your API key is invalid, expired, or missing. "
                "Verify the api_key in your Logwell config matches your project settings.",
                LogwellErrorCode.UNAUTHORIZED,
                status,
                False,
            )
        elif status == 400:
            return LogwellError(
                f"Invalid log data (400): {message}. "
                "The server rejected the log entries. Check that log entries "
                "have valid 'level' and 'message' fields.",
                LogwellErrorCode.VALIDATION_ERROR,
                status,
                False,
            )
        elif status == 429:
            return LogwellError(
                f"Rate limit exceeded (429): {message}. "
                "Too many requests sent to the server. The SDK will automatically "
                "retry with exponential backoff.",
                LogwellErrorCode.RATE_LIMITED,
                status,
                True,
            )
        elif status >= 500:
            return LogwellError(
                f"Server error ({status}): {message}. "
                "The Logwell server encountered an error. This is typically temporary. "
                "The SDK will automatically retry with exponential backoff.",
                LogwellErrorCode.SERVER_ERROR,
                status,
                True,
            )
        else:
            return LogwellError(
                f"Unexpected HTTP error ({status}): {message}. "
                "The server returned an unexpected status code. "
                "Check the server logs or contact support if this persists.",
                LogwellErrorCode.SERVER_ERROR,
                status,
                False,
            )
