from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call, patch

import httpx
import pytest

from logwell.errors import LogwellError, LogwellErrorCode
from logwell.transport import HttpTransport

VALID_KEY = "lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
VALID_ENDPOINT = "https://logs.example.com"


def _make_transport(max_retries: int = 1) -> HttpTransport:
    transport = HttpTransport(
        {
            "api_key": VALID_KEY,
            "endpoint": VALID_ENDPOINT,
            "max_retries": max_retries,
        }
    )
    transport._client = MagicMock()  # type: ignore[assignment]
    return transport


def _make_429_response(retry_after: str) -> httpx.Response:
    return httpx.Response(
        status_code=429,
        json={"error": "Too many requests"},
        headers={"Retry-After": retry_after},
    )


class TestRetryAfterCap:
    @pytest.mark.asyncio
    async def test_retry_after_capped_at_backoff_ceiling(self) -> None:
        transport = _make_transport(max_retries=1)
        transport._client.post = AsyncMock(  # type: ignore[attr-defined]
            return_value=_make_429_response("3600")
        )

        with (
            patch("asyncio.sleep", new=AsyncMock()) as mock_sleep,
            pytest.raises(LogwellError) as exc_info,
        ):
            await transport.send([{"level": "info", "message": "hello"}])

        assert exc_info.value.code == LogwellErrorCode.RATE_LIMITED
        mock_sleep.assert_awaited_once_with(0.1)

    @pytest.mark.asyncio
    async def test_retry_after_below_backoff_is_honored(self) -> None:
        transport = _make_transport(max_retries=1)
        transport._client.post = AsyncMock(  # type: ignore[attr-defined]
            return_value=_make_429_response("0.05")
        )

        with (
            patch("asyncio.sleep", new=AsyncMock()) as mock_sleep,
            pytest.raises(LogwellError) as exc_info,
        ):
            await transport.send([{"level": "info", "message": "hello"}])

        assert exc_info.value.code == LogwellErrorCode.RATE_LIMITED
        mock_sleep.assert_awaited_once_with(0.05)

    @pytest.mark.asyncio
    async def test_retry_after_cap_scales_with_attempt(self) -> None:
        transport = _make_transport(max_retries=2)
        transport._client.post = AsyncMock(  # type: ignore[attr-defined]
            return_value=_make_429_response("3600")
        )

        with (
            patch("asyncio.sleep", new=AsyncMock()) as mock_sleep,
            pytest.raises(LogwellError),
        ):
            await transport.send([{"level": "info", "message": "hello"}])

        assert mock_sleep.await_args_list == [call(0.1), call(0.2)]

    @pytest.mark.asyncio
    async def test_no_retry_after_uses_jittered_backoff(self) -> None:
        transport = _make_transport(max_retries=1)
        transport._client.post = AsyncMock(  # type: ignore[attr-defined]
            return_value=httpx.Response(status_code=429, json={"error": "rate limited"})
        )

        with (
            patch("asyncio.sleep", new=AsyncMock()) as mock_sleep,
            pytest.raises(LogwellError),
        ):
            await transport.send([{"level": "info", "message": "hello"}])

        assert len(mock_sleep.await_args_list) == 1
        slept = mock_sleep.await_args_list[0].args[0]
        assert 0.1 <= slept < 0.13
