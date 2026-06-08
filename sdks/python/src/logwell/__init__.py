"""Logwell Python SDK - Official logging client for Logwell platform."""

from importlib.metadata import PackageNotFoundError, version

from logwell.client import Logwell
from logwell.errors import LogwellError, LogwellErrorCode
from logwell.types import IngestResponse, LogEntry, LogLevel, LogwellConfig

try:
    __version__ = version("logwell")
except PackageNotFoundError:
    __version__ = "unknown"
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
