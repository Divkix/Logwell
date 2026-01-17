"""Configuration validation for the Logwell Python SDK.

This module provides configuration defaults, validation functions,
and config merging utilities.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from logwell.errors import LogwellError, LogwellErrorCode
from logwell.types import LogwellConfig

# Default configuration values
DEFAULT_CONFIG: dict[str, Any] = {
    "batch_size": 50,
    "flush_interval": 5.0,  # seconds
    "max_queue_size": 1000,
    "max_retries": 3,
    "capture_source_location": False,
}

# API key format regex: lw_[32 alphanumeric chars including - and _]
API_KEY_REGEX: re.Pattern[str] = re.compile(r"^lw_[A-Za-z0-9_-]{32}$")


def validate_api_key_format(api_key: str) -> bool:
    """Validate API key format.

    Args:
        api_key: API key to validate

    Returns:
        True if valid format, False otherwise
    """
    if not api_key or not isinstance(api_key, str):
        return False
    return bool(API_KEY_REGEX.match(api_key))


def _is_valid_url(url: str) -> bool:
    """Validate a URL string.

    Args:
        url: URL string to validate

    Returns:
        True if valid URL with scheme and netloc, False otherwise
    """
    try:
        result = urlparse(url)
        return bool(result.scheme and result.netloc)
    except (ValueError, AttributeError):
        return False


def validate_config(config: LogwellConfig) -> LogwellConfig:
    """Validate configuration and return merged config with defaults.

    Args:
        config: Configuration dict to validate

    Returns:
        Complete configuration with defaults applied

    Raises:
        LogwellError: If configuration is invalid (INVALID_CONFIG code)
    """
    # Validate required fields
    if "api_key" not in config or not config["api_key"]:
        raise LogwellError(
            "api_key is required",
            LogwellErrorCode.INVALID_CONFIG,
        )

    if "endpoint" not in config or not config["endpoint"]:
        raise LogwellError(
            "endpoint is required",
            LogwellErrorCode.INVALID_CONFIG,
        )

    # Validate API key format
    if not validate_api_key_format(config["api_key"]):
        raise LogwellError(
            "Invalid API key format. Expected: lw_[32 characters]",
            LogwellErrorCode.INVALID_CONFIG,
        )

    # Validate endpoint URL
    if not _is_valid_url(config["endpoint"]):
        raise LogwellError(
            "Invalid endpoint URL",
            LogwellErrorCode.INVALID_CONFIG,
        )

    # Validate numeric options
    if "batch_size" in config and config["batch_size"] <= 0:
        raise LogwellError(
            "batch_size must be positive",
            LogwellErrorCode.INVALID_CONFIG,
        )

    if "flush_interval" in config and config["flush_interval"] <= 0:
        raise LogwellError(
            "flush_interval must be positive",
            LogwellErrorCode.INVALID_CONFIG,
        )

    if "max_queue_size" in config and config["max_queue_size"] <= 0:
        raise LogwellError(
            "max_queue_size must be positive",
            LogwellErrorCode.INVALID_CONFIG,
        )

    if "max_retries" in config and config["max_retries"] < 0:
        raise LogwellError(
            "max_retries must be non-negative",
            LogwellErrorCode.INVALID_CONFIG,
        )

    # Return merged config with defaults
    merged: LogwellConfig = {
        "api_key": config["api_key"],
        "endpoint": config["endpoint"],
        "batch_size": config.get("batch_size", DEFAULT_CONFIG["batch_size"]),
        "flush_interval": config.get("flush_interval", DEFAULT_CONFIG["flush_interval"]),
        "max_queue_size": config.get("max_queue_size", DEFAULT_CONFIG["max_queue_size"]),
        "max_retries": config.get("max_retries", DEFAULT_CONFIG["max_retries"]),
        "capture_source_location": config.get(
            "capture_source_location", DEFAULT_CONFIG["capture_source_location"]
        ),
    }

    # Add optional fields if present
    if "service" in config:
        merged["service"] = config["service"]

    if "on_error" in config:
        merged["on_error"] = config["on_error"]

    if "on_flush" in config:
        merged["on_flush"] = config["on_flush"]

    return merged
