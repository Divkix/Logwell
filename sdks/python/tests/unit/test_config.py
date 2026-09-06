from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from logwell.config import validate_config
from logwell.errors import LogwellError, LogwellErrorCode

if TYPE_CHECKING:
    from logwell.types import LogwellConfig


class TestFlushIntervalFloorGap:
    """Config bounds are pinned by the TS reference SDK. The one Python delta:
    TS/Go enforce a 100ms flush floor, Python only rejects <= 0."""

    def test_flush_interval_zero_rejected(self, valid_config: LogwellConfig) -> None:
        config = dict(valid_config)
        config["flush_interval"] = 0.0

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "flush_interval" in exc_info.value.message

    def test_flush_interval_negative_rejected(self, valid_config: LogwellConfig) -> None:
        config = dict(valid_config)
        config["flush_interval"] = -1.0

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "flush_interval" in exc_info.value.message

    def test_sub_floor_flush_interval_accepted_no_100ms_floor(
        self, valid_config: LogwellConfig
    ) -> None:
        config = dict(valid_config)
        config["flush_interval"] = 0.001

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["flush_interval"] == 0.001
