from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import pytest
import respx

from logwell import Logwell

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
