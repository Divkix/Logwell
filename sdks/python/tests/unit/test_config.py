"""Unit tests for config.py - validate_config and validate_api_key_format.

Tests cover:
- validate_api_key_format: valid keys, invalid keys (wrong prefix, wrong length, invalid chars)
- validate_config: missing/empty required fields, invalid formats, numeric bounds
- validate_config: default value merging and optional field handling
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from logwell.config import (
    API_KEY_REGEX,
    DEFAULT_CONFIG,
    validate_api_key_format,
    validate_config,
)
from logwell.errors import LogwellError, LogwellErrorCode

if TYPE_CHECKING:
    from logwell.types import LogwellConfig


# =============================================================================
# validate_api_key_format Tests
# =============================================================================


class TestValidateApiKeyFormat:
    """Tests for validate_api_key_format function."""

    def test_valid_api_key_lowercase(self) -> None:
        """Valid key with lowercase alphanumeric chars."""
        assert validate_api_key_format("lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") is True

    def test_valid_api_key_uppercase(self) -> None:
        """Valid key with uppercase alphanumeric chars."""
        assert validate_api_key_format("lw_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") is True

    def test_valid_api_key_mixed_case(self) -> None:
        """Valid key with mixed case alphanumeric chars."""
        assert validate_api_key_format("lw_AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPp") is True

    def test_valid_api_key_with_numbers(self) -> None:
        """Valid key with numbers."""
        assert validate_api_key_format("lw_12345678901234567890123456789012") is True

    def test_valid_api_key_with_hyphens(self) -> None:
        """Valid key with hyphens."""
        # 32 chars: abcd-efgh-ijkl-mnop-qrst-uvwx012
        assert validate_api_key_format("lw_abcd-efgh-ijkl-mnop-qrst-uvwx012") is True

    def test_valid_api_key_with_underscores(self) -> None:
        """Valid key with underscores after prefix."""
        # 32 chars: abcd_efgh_ijkl_mnop_qrst_uvwx_012
        assert validate_api_key_format("lw_abcd_efgh_ijkl_mnop_qrst_uvwx012") is True

    def test_valid_api_key_mixed_special_chars(self) -> None:
        """Valid key with mixed hyphens, underscores, and alphanumeric."""
        # 32 chars: aB3_Cd5-Ef7_Gh9-Ij1_Kl3-Mn5_Op7XY
        assert validate_api_key_format("lw_aB3_Cd5-Ef7_Gh9-Ij1_Kl3-Mn5Op7XY") is True

    def test_invalid_api_key_wrong_prefix(self) -> None:
        """Invalid key with wrong prefix."""
        assert validate_api_key_format("pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") is False

    def test_invalid_api_key_no_prefix(self) -> None:
        """Invalid key with no prefix."""
        assert validate_api_key_format("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") is False

    def test_invalid_api_key_too_short(self) -> None:
        """Invalid key that is too short."""
        assert validate_api_key_format("lw_short") is False

    def test_invalid_api_key_too_long(self) -> None:
        """Invalid key that is too long."""
        assert validate_api_key_format("lw_" + "a" * 40) is False

    def test_invalid_api_key_31_chars_after_prefix(self) -> None:
        """Invalid key with exactly 31 chars after prefix (off by one)."""
        assert validate_api_key_format("lw_" + "a" * 31) is False

    def test_invalid_api_key_33_chars_after_prefix(self) -> None:
        """Invalid key with exactly 33 chars after prefix (off by one)."""
        assert validate_api_key_format("lw_" + "a" * 33) is False

    def test_invalid_api_key_special_chars(self) -> None:
        """Invalid key with invalid special characters."""
        assert validate_api_key_format("lw_aaaaaaaaaa!@#$%^&*()aaaaaaaaaa") is False

    def test_invalid_api_key_spaces(self) -> None:
        """Invalid key with spaces."""
        assert validate_api_key_format("lw_aaaa aaaa aaaa aaaa aaaa aaaa a") is False

    def test_invalid_api_key_empty_string(self) -> None:
        """Invalid key - empty string."""
        assert validate_api_key_format("") is False

    def test_invalid_api_key_none(self) -> None:
        """Invalid key - None value."""
        assert validate_api_key_format(None) is False  # type: ignore[arg-type]

    def test_invalid_api_key_number(self) -> None:
        """Invalid key - number instead of string."""
        assert validate_api_key_format(12345) is False  # type: ignore[arg-type]

    def test_invalid_api_key_list(self) -> None:
        """Invalid key - list instead of string."""
        assert validate_api_key_format(["lw_aaa"]) is False  # type: ignore[arg-type]

    def test_invalid_api_key_dict(self) -> None:
        """Invalid key - dict instead of string."""
        assert validate_api_key_format({"key": "value"}) is False  # type: ignore[arg-type]

    def test_api_key_regex_pattern(self) -> None:
        """Verify the regex pattern is correct."""
        # Pattern should be: ^lw_[A-Za-z0-9_-]{32}$
        assert API_KEY_REGEX.pattern == r"^lw_[A-Za-z0-9_-]{32}$"


# =============================================================================
# validate_config Tests - Missing/Empty Required Fields
# =============================================================================


class TestValidateConfigMissingFields:
    """Tests for validate_config with missing or empty required fields."""

    def test_missing_api_key(self, valid_endpoint: str) -> None:
        """Raises LogwellError when api_key is missing."""
        config: dict[str, Any] = {"endpoint": valid_endpoint}

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "api_key" in exc_info.value.message

    def test_empty_api_key(self, valid_endpoint: str) -> None:
        """Raises LogwellError when api_key is empty string."""
        config: dict[str, Any] = {"api_key": "", "endpoint": valid_endpoint}

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "api_key" in exc_info.value.message

    def test_none_api_key(self, valid_endpoint: str) -> None:
        """Raises LogwellError when api_key is None."""
        config: dict[str, Any] = {"api_key": None, "endpoint": valid_endpoint}

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "api_key" in exc_info.value.message

    def test_missing_endpoint(self, valid_api_key: str) -> None:
        """Raises LogwellError when endpoint is missing."""
        config: dict[str, Any] = {"api_key": valid_api_key}

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "endpoint" in exc_info.value.message

    def test_empty_endpoint(self, valid_api_key: str) -> None:
        """Raises LogwellError when endpoint is empty string."""
        config: dict[str, Any] = {"api_key": valid_api_key, "endpoint": ""}

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "endpoint" in exc_info.value.message

    def test_none_endpoint(self, valid_api_key: str) -> None:
        """Raises LogwellError when endpoint is None."""
        config: dict[str, Any] = {"api_key": valid_api_key, "endpoint": None}

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "endpoint" in exc_info.value.message

    def test_both_missing(self) -> None:
        """Raises LogwellError when both required fields are missing."""
        config: dict[str, Any] = {}

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        # api_key is checked first
        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "api_key" in exc_info.value.message


# =============================================================================
# validate_config Tests - Invalid API Key Format
# =============================================================================


class TestValidateConfigInvalidApiKey:
    """Tests for validate_config with invalid API key formats."""

    def test_wrong_prefix(self, valid_endpoint: str) -> None:
        """Raises LogwellError when API key has wrong prefix."""
        config: dict[str, Any] = {
            "api_key": "pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "endpoint": valid_endpoint,
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "Invalid API key format" in exc_info.value.message

    def test_too_short(self, valid_endpoint: str) -> None:
        """Raises LogwellError when API key is too short."""
        config: dict[str, Any] = {
            "api_key": "lw_short",
            "endpoint": valid_endpoint,
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "Invalid API key format" in exc_info.value.message

    def test_too_long(self, valid_endpoint: str) -> None:
        """Raises LogwellError when API key is too long."""
        config: dict[str, Any] = {
            "api_key": "lw_" + "a" * 40,
            "endpoint": valid_endpoint,
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "Invalid API key format" in exc_info.value.message

    def test_invalid_chars(self, valid_endpoint: str) -> None:
        """Raises LogwellError when API key has invalid characters."""
        config: dict[str, Any] = {
            "api_key": "lw_aaaaaaaaaa!@#$aaaaaaaaaaaaaaaa",
            "endpoint": valid_endpoint,
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "Invalid API key format" in exc_info.value.message

    def test_error_message_masks_key(self, valid_endpoint: str) -> None:
        """Error message masks the API key for security."""
        long_key = "lw_this_is_a_very_long_invalid_key_that_should_be_masked"
        config: dict[str, Any] = {
            "api_key": long_key,
            "endpoint": valid_endpoint,
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        # Key should be masked after first 10 chars
        assert long_key not in exc_info.value.message
        assert "lw_this_is..." in exc_info.value.message

    def test_error_message_short_key_masked(self, valid_endpoint: str) -> None:
        """Error message masks short API keys as ***."""
        short_key = "lw_abc"
        config: dict[str, Any] = {
            "api_key": short_key,
            "endpoint": valid_endpoint,
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        # Short keys should show ***
        assert short_key not in exc_info.value.message
        assert "***" in exc_info.value.message


# =============================================================================
# validate_config Tests - Invalid Endpoint URL
# =============================================================================


class TestValidateConfigInvalidEndpoint:
    """Tests for validate_config with invalid endpoint URLs."""

    def test_missing_scheme(self, valid_api_key: str) -> None:
        """Raises LogwellError when endpoint has no scheme."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "logs.example.com",
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "Invalid endpoint URL" in exc_info.value.message

    def test_relative_path(self, valid_api_key: str) -> None:
        """Raises LogwellError when endpoint is a relative path."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "/api/logs",
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "Invalid endpoint URL" in exc_info.value.message

    def test_scheme_only(self, valid_api_key: str) -> None:
        """Raises LogwellError when endpoint is scheme only."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://",
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "Invalid endpoint URL" in exc_info.value.message

    def test_valid_http_endpoint(self, valid_api_key: str) -> None:
        """Accepts HTTP endpoint (for local development)."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "http://localhost:3000",
        }

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["endpoint"] == "http://localhost:3000"

    def test_valid_https_endpoint(self, valid_api_key: str) -> None:
        """Accepts HTTPS endpoint."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://logs.example.com",
        }

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["endpoint"] == "https://logs.example.com"

    def test_endpoint_with_path(self, valid_api_key: str) -> None:
        """Accepts endpoint with path."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://logs.example.com/v1",
        }

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["endpoint"] == "https://logs.example.com/v1"

    def test_endpoint_with_port(self, valid_api_key: str) -> None:
        """Accepts endpoint with port."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://logs.example.com:8443",
        }

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["endpoint"] == "https://logs.example.com:8443"


# =============================================================================
# validate_config Tests - Numeric Bounds
# =============================================================================


class TestValidateConfigNumericBounds:
    """Tests for validate_config with numeric boundary conditions."""

    # batch_size tests
    def test_batch_size_negative(self, valid_config: LogwellConfig) -> None:
        """Raises LogwellError when batch_size is negative."""
        config = dict(valid_config)
        config["batch_size"] = -1

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "batch_size" in exc_info.value.message

    def test_batch_size_zero(self, valid_config: LogwellConfig) -> None:
        """Raises LogwellError when batch_size is zero."""
        config = dict(valid_config)
        config["batch_size"] = 0

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "batch_size" in exc_info.value.message

    def test_batch_size_positive(self, valid_config: LogwellConfig) -> None:
        """Accepts batch_size when positive."""
        config = dict(valid_config)
        config["batch_size"] = 1

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["batch_size"] == 1

    def test_batch_size_large(self, valid_config: LogwellConfig) -> None:
        """Accepts large batch_size values."""
        config = dict(valid_config)
        config["batch_size"] = 10000

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["batch_size"] == 10000

    # flush_interval tests
    def test_flush_interval_negative(self, valid_config: LogwellConfig) -> None:
        """Raises LogwellError when flush_interval is negative."""
        config = dict(valid_config)
        config["flush_interval"] = -1.0

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "flush_interval" in exc_info.value.message

    def test_flush_interval_zero(self, valid_config: LogwellConfig) -> None:
        """Raises LogwellError when flush_interval is zero."""
        config = dict(valid_config)
        config["flush_interval"] = 0.0

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "flush_interval" in exc_info.value.message

    def test_flush_interval_small_positive(self, valid_config: LogwellConfig) -> None:
        """Accepts small positive flush_interval."""
        config = dict(valid_config)
        config["flush_interval"] = 0.001

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["flush_interval"] == 0.001

    def test_flush_interval_integer(self, valid_config: LogwellConfig) -> None:
        """Accepts integer flush_interval."""
        config = dict(valid_config)
        config["flush_interval"] = 10

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["flush_interval"] == 10

    # max_queue_size tests
    def test_max_queue_size_negative(self, valid_config: LogwellConfig) -> None:
        """Raises LogwellError when max_queue_size is negative."""
        config = dict(valid_config)
        config["max_queue_size"] = -100

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "max_queue_size" in exc_info.value.message

    def test_max_queue_size_zero(self, valid_config: LogwellConfig) -> None:
        """Raises LogwellError when max_queue_size is zero."""
        config = dict(valid_config)
        config["max_queue_size"] = 0

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "max_queue_size" in exc_info.value.message

    def test_max_queue_size_positive(self, valid_config: LogwellConfig) -> None:
        """Accepts positive max_queue_size."""
        config = dict(valid_config)
        config["max_queue_size"] = 1

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["max_queue_size"] == 1

    # max_retries tests
    def test_max_retries_negative(self, valid_config: LogwellConfig) -> None:
        """Raises LogwellError when max_retries is negative."""
        config = dict(valid_config)
        config["max_retries"] = -1

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
        assert "max_retries" in exc_info.value.message

    def test_max_retries_zero(self, valid_config: LogwellConfig) -> None:
        """Accepts max_retries of zero (disables retries)."""
        config = dict(valid_config)
        config["max_retries"] = 0

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["max_retries"] == 0

    def test_max_retries_positive(self, valid_config: LogwellConfig) -> None:
        """Accepts positive max_retries."""
        config = dict(valid_config)
        config["max_retries"] = 10

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["max_retries"] == 10


# =============================================================================
# validate_config Tests - Default Value Merging
# =============================================================================


class TestValidateConfigDefaults:
    """Tests for validate_config default value merging."""

    def test_applies_all_defaults(self, valid_config: LogwellConfig) -> None:
        """Applies all default values when not provided."""
        result = validate_config(valid_config)

        assert result["batch_size"] == DEFAULT_CONFIG["batch_size"]
        assert result["flush_interval"] == DEFAULT_CONFIG["flush_interval"]
        assert result["max_queue_size"] == DEFAULT_CONFIG["max_queue_size"]
        assert result["max_retries"] == DEFAULT_CONFIG["max_retries"]
        assert result["capture_source_location"] == DEFAULT_CONFIG["capture_source_location"]

    def test_preserves_provided_values(self, valid_config_full: LogwellConfig) -> None:
        """Preserves user-provided values over defaults."""
        result = validate_config(valid_config_full)

        assert result["batch_size"] == 100
        assert result["flush_interval"] == 10.0
        assert result["max_queue_size"] == 500
        assert result["max_retries"] == 5
        assert result["capture_source_location"] is True

    def test_partial_overrides(self, valid_config: LogwellConfig) -> None:
        """Allows partial override of defaults."""
        config = dict(valid_config)
        config["batch_size"] = 200
        config["max_retries"] = 10

        result = validate_config(config)  # type: ignore[arg-type]

        # Overridden values
        assert result["batch_size"] == 200
        assert result["max_retries"] == 10
        # Default values
        assert result["flush_interval"] == DEFAULT_CONFIG["flush_interval"]
        assert result["max_queue_size"] == DEFAULT_CONFIG["max_queue_size"]
        assert result["capture_source_location"] == DEFAULT_CONFIG["capture_source_location"]

    def test_default_config_values(self) -> None:
        """Verify DEFAULT_CONFIG values are correct."""
        assert DEFAULT_CONFIG["batch_size"] == 50
        assert DEFAULT_CONFIG["flush_interval"] == 5.0
        assert DEFAULT_CONFIG["max_queue_size"] == 1000
        assert DEFAULT_CONFIG["max_retries"] == 3
        assert DEFAULT_CONFIG["capture_source_location"] is False


# =============================================================================
# validate_config Tests - Optional Fields
# =============================================================================


class TestValidateConfigOptionalFields:
    """Tests for validate_config optional field handling."""

    def test_service_preserved(self, valid_config: LogwellConfig) -> None:
        """Preserves service name when provided."""
        config = dict(valid_config)
        config["service"] = "my-service"

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["service"] == "my-service"

    def test_service_not_added_by_default(self, valid_config: LogwellConfig) -> None:
        """Does not add service when not provided."""
        result = validate_config(valid_config)
        assert "service" not in result

    def test_on_error_callback_preserved(
        self, valid_config: LogwellConfig, mock_on_error: Any
    ) -> None:
        """Preserves on_error callback when provided."""
        config = dict(valid_config)
        config["on_error"] = mock_on_error

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["on_error"] is mock_on_error

    def test_on_error_not_added_by_default(self, valid_config: LogwellConfig) -> None:
        """Does not add on_error when not provided."""
        result = validate_config(valid_config)
        assert "on_error" not in result

    def test_on_flush_callback_preserved(
        self, valid_config: LogwellConfig, mock_on_flush: Any
    ) -> None:
        """Preserves on_flush callback when provided."""
        config = dict(valid_config)
        config["on_flush"] = mock_on_flush

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["on_flush"] is mock_on_flush

    def test_on_flush_not_added_by_default(self, valid_config: LogwellConfig) -> None:
        """Does not add on_flush when not provided."""
        result = validate_config(valid_config)
        assert "on_flush" not in result

    def test_capture_source_location_true(self, valid_config: LogwellConfig) -> None:
        """Accepts capture_source_location=True."""
        config = dict(valid_config)
        config["capture_source_location"] = True

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["capture_source_location"] is True

    def test_capture_source_location_false(self, valid_config: LogwellConfig) -> None:
        """Accepts capture_source_location=False."""
        config = dict(valid_config)
        config["capture_source_location"] = False

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["capture_source_location"] is False


# =============================================================================
# validate_config Tests - Return Value Structure
# =============================================================================


class TestValidateConfigReturnValue:
    """Tests for validate_config return value structure."""

    def test_returns_logwell_config_type(self, valid_config: LogwellConfig) -> None:
        """Returns a LogwellConfig dict."""
        result = validate_config(valid_config)

        # Required fields present
        assert "api_key" in result
        assert "endpoint" in result

        # Default fields present
        assert "batch_size" in result
        assert "flush_interval" in result
        assert "max_queue_size" in result
        assert "max_retries" in result
        assert "capture_source_location" in result

    def test_returns_copy_not_reference(self, valid_config: LogwellConfig) -> None:
        """Returns a new dict, not a reference to input."""
        result = validate_config(valid_config)

        # Modify result should not affect input
        result["batch_size"] = 9999
        assert valid_config.get("batch_size") != 9999

    def test_all_values_present_in_full_config(self, valid_config_full: LogwellConfig) -> None:
        """Full config returns all provided values."""
        result = validate_config(valid_config_full)

        assert result["api_key"] == valid_config_full["api_key"]
        assert result["endpoint"] == valid_config_full["endpoint"]
        assert result["service"] == valid_config_full["service"]
        assert result["batch_size"] == valid_config_full["batch_size"]
        assert result["flush_interval"] == valid_config_full["flush_interval"]
        assert result["max_queue_size"] == valid_config_full["max_queue_size"]
        assert result["max_retries"] == valid_config_full["max_retries"]
        assert result["capture_source_location"] == valid_config_full["capture_source_location"]


# =============================================================================
# Edge Cases
# =============================================================================


class TestIsValidUrlEdgeCases:
    """Edge cases for _is_valid_url internal function (via validate_config)."""

    def test_url_that_triggers_exception(self, valid_api_key: str) -> None:
        """Test URL that might trigger urlparse exception.

        urlparse is very permissive and rarely throws, but we can test
        by mocking to ensure the exception path returns False.
        """
        from unittest.mock import patch

        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://valid.example.com",
        }

        # Mock urlparse to raise an exception
        with patch("logwell.config.urlparse") as mock_urlparse:
            mock_urlparse.side_effect = ValueError("Mock error")

            with pytest.raises(LogwellError) as exc_info:
                validate_config(config)  # type: ignore[arg-type]

            assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
            assert "Invalid endpoint URL" in exc_info.value.message

    def test_url_with_attribute_error(self, valid_api_key: str) -> None:
        """Test URL that causes AttributeError in urlparse."""
        from unittest.mock import patch

        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://valid.example.com",
        }

        # Mock urlparse to raise AttributeError
        with patch("logwell.config.urlparse") as mock_urlparse:
            mock_urlparse.side_effect = AttributeError("Mock attribute error")

            with pytest.raises(LogwellError) as exc_info:
                validate_config(config)  # type: ignore[arg-type]

            assert exc_info.value.code == LogwellErrorCode.INVALID_CONFIG
            assert "Invalid endpoint URL" in exc_info.value.message


class TestValidateConfigEdgeCases:
    """Edge case tests for validate_config."""

    def test_api_key_exactly_32_chars_after_prefix(self, valid_endpoint: str) -> None:
        """Accepts API key with exactly 32 chars after prefix."""
        config: dict[str, Any] = {
            "api_key": "lw_" + "a" * 32,
            "endpoint": valid_endpoint,
        }

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["api_key"] == "lw_" + "a" * 32

    def test_endpoint_with_trailing_slash(self, valid_api_key: str) -> None:
        """Accepts endpoint with trailing slash."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://logs.example.com/",
        }

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["endpoint"] == "https://logs.example.com/"

    def test_endpoint_with_query_params(self, valid_api_key: str) -> None:
        """Accepts endpoint with query parameters."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "https://logs.example.com?project=test",
        }

        result = validate_config(config)  # type: ignore[arg-type]
        assert result["endpoint"] == "https://logs.example.com?project=test"

    def test_validates_in_order(self, valid_endpoint: str) -> None:
        """Validates api_key before endpoint."""
        config: dict[str, Any] = {
            "api_key": "",  # Invalid
            "endpoint": "invalid",  # Also invalid
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        # api_key error should come first
        assert "api_key" in exc_info.value.message

    def test_api_key_format_checked_before_numeric_bounds(self, valid_endpoint: str) -> None:
        """API key format checked before numeric options."""
        config: dict[str, Any] = {
            "api_key": "invalid_key",
            "endpoint": valid_endpoint,
            "batch_size": -1,  # Also invalid
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        # api_key format error should come first
        assert "Invalid API key format" in exc_info.value.message

    def test_endpoint_checked_before_numeric_bounds(self, valid_api_key: str) -> None:
        """Endpoint URL checked before numeric options."""
        config: dict[str, Any] = {
            "api_key": valid_api_key,
            "endpoint": "invalid-url",
            "batch_size": -1,  # Also invalid
        }

        with pytest.raises(LogwellError) as exc_info:
            validate_config(config)  # type: ignore[arg-type]

        # endpoint error should come first
        assert "Invalid endpoint URL" in exc_info.value.message
