"""Logwell Python SDK - Official logging client for Logwell platform."""

from logwell.client import Logwell
from logwell.errors import LogwellError, LogwellErrorCode
from logwell.types import IngestResponse, LogEntry, LogLevel, LogwellConfig

__version__ = "0.1.0"
__all__ = [
    "__version__",
    "IngestResponse",
    "LogEntry",
    "LogLevel",
    "Logwell",
    "LogwellConfig",
    "LogwellError",
    "LogwellErrorCode",
]
