"""Main client class for the Logwell Python SDK.

This module provides the Logwell class, the primary entry point for
logging to the Logwell platform.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from logwell.config import validate_config
from logwell.queue import BatchQueue, QueueConfig
from logwell.source_location import capture_source_location
from logwell.transport import HttpTransport

if TYPE_CHECKING:
    from logwell.types import IngestResponse, LogEntry, LogwellConfig


class Logwell:
    """Main Logwell client for logging to the Logwell platform.

    Provides methods for logging at different levels with automatic
    batching, retry, and queue management.

    Example:
        >>> client = Logwell({
        ...     'api_key': 'lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ...     'endpoint': 'https://logs.example.com',
        ...     'service': 'my-app',
        ... })
        >>> client.info('User logged in', {'user_id': '123'})
        >>> await client.shutdown()
    """

    def __init__(
        self,
        config: LogwellConfig,
        *,
        _queue: BatchQueue | None = None,
        _parent_metadata: dict[str, Any] | None = None,
    ) -> None:
        """Initialize the Logwell client.

        Args:
            config: Configuration dict with api_key, endpoint, and optional settings
            _queue: Internal: shared queue for child loggers (do not use directly)
            _parent_metadata: Internal: inherited metadata from parent (do not use directly)
        """
        # Validate and apply defaults
        self._config = validate_config(config)
        self._parent_metadata = _parent_metadata
        self._stopped = False

        # Create transport
        self._transport = HttpTransport(self._config)

        # Use existing queue (for child loggers) or create new one
        if _queue is not None:
            self._queue = _queue
            self._owns_queue = False
        else:
            queue_config = QueueConfig.from_logwell_config(self._config)
            self._queue = BatchQueue(
                send_batch=self._transport.send,
                config=queue_config,
            )
            self._owns_queue = True

    @property
    def queue_size(self) -> int:
        """Current number of logs waiting in the queue."""
        return self._queue.size

    def _add_log(self, entry: LogEntry, skip_frames: int) -> None:
        """Internal log method with source location capture.

        Args:
            entry: The log entry to add
            skip_frames: Number of frames to skip for source location
        """
        if self._stopped:
            return

        source_file: str | None = None
        line_number: int | None = None

        if self._config.get("capture_source_location", False):
            location = capture_source_location(skip_frames)
            if location:
                source_file = location.source_file
                line_number = location.line_number

        # Build full entry with defaults
        full_entry: LogEntry = {
            "level": entry["level"],
            "message": entry["message"],
            "timestamp": entry.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        }

        # Add service from entry, config, or omit
        service = entry.get("service") or self._config.get("service")
        if service:
            full_entry["service"] = service

        # Merge metadata
        merged_metadata = self._merge_metadata(entry.get("metadata"))
        if merged_metadata:
            full_entry["metadata"] = merged_metadata

        # Add source location if captured
        if source_file is not None:
            full_entry["source_file"] = source_file
        if line_number is not None:
            full_entry["line_number"] = line_number

        self._queue.add(full_entry)

    def log(self, entry: LogEntry) -> None:
        """Log a message at the specified level.

        Args:
            entry: Log entry with level, message, and optional metadata
        """
        self._add_log(entry, skip_frames=2)

    def debug(self, message: str, metadata: dict[str, Any] | None = None) -> None:
        """Log a debug message.

        Args:
            message: Log message content
            metadata: Optional key-value metadata
        """
        entry: LogEntry = {"level": "debug", "message": message}
        if metadata:
            entry["metadata"] = metadata
        self._add_log(entry, skip_frames=2)

    def info(self, message: str, metadata: dict[str, Any] | None = None) -> None:
        """Log an info message.

        Args:
            message: Log message content
            metadata: Optional key-value metadata
        """
        entry: LogEntry = {"level": "info", "message": message}
        if metadata:
            entry["metadata"] = metadata
        self._add_log(entry, skip_frames=2)

    def warn(self, message: str, metadata: dict[str, Any] | None = None) -> None:
        """Log a warning message.

        Args:
            message: Log message content
            metadata: Optional key-value metadata
        """
        entry: LogEntry = {"level": "warn", "message": message}
        if metadata:
            entry["metadata"] = metadata
        self._add_log(entry, skip_frames=2)

    def error(self, message: str, metadata: dict[str, Any] | None = None) -> None:
        """Log an error message.

        Args:
            message: Log message content
            metadata: Optional key-value metadata
        """
        entry: LogEntry = {"level": "error", "message": message}
        if metadata:
            entry["metadata"] = metadata
        self._add_log(entry, skip_frames=2)

    def fatal(self, message: str, metadata: dict[str, Any] | None = None) -> None:
        """Log a fatal error message.

        Args:
            message: Log message content
            metadata: Optional key-value metadata
        """
        entry: LogEntry = {"level": "fatal", "message": message}
        if metadata:
            entry["metadata"] = metadata
        self._add_log(entry, skip_frames=2)

    async def flush(self) -> IngestResponse | None:
        """Flush all queued logs immediately.

        Returns:
            Response from the server, or None if queue was empty
        """
        return await self._queue.flush()

    async def shutdown(self) -> None:
        """Flush remaining logs and stop the client.

        Call this before process exit to ensure all logs are sent.
        This method is idempotent (safe to call multiple times).
        """
        self._stopped = True
        if self._owns_queue:
            await self._queue.shutdown()
            await self._transport.close()

    def child(
        self,
        metadata: dict[str, Any] | None = None,
        *,
        service: str | None = None,
    ) -> Logwell:
        """Create a child logger with additional context.

        Child loggers share the same queue as the parent,
        but can have their own service name and default metadata.

        Args:
            metadata: Additional metadata to include in all logs from this child
            service: Override service name for this child logger

        Returns:
            A new Logwell instance sharing the parent's queue

        Example:
            >>> request_logger = logger.child({'request_id': req.id})
            >>> request_logger.info('Request received')
        """
        child_config: LogwellConfig = {
            "api_key": self._config["api_key"],
            "endpoint": self._config["endpoint"],
            "batch_size": self._config.get("batch_size", 50),
            "flush_interval": self._config.get("flush_interval", 5.0),
            "max_queue_size": self._config.get("max_queue_size", 1000),
            "max_retries": self._config.get("max_retries", 3),
            "capture_source_location": self._config.get("capture_source_location", False),
        }

        # Set service: override > config > none
        if service is not None:
            child_config["service"] = service
        elif "service" in self._config:
            child_config["service"] = self._config["service"]

        # Preserve callbacks
        if "on_error" in self._config:
            child_config["on_error"] = self._config["on_error"]
        if "on_flush" in self._config:
            child_config["on_flush"] = self._config["on_flush"]

        # Merge metadata: parent -> new
        child_metadata: dict[str, Any] | None = None
        if self._parent_metadata or metadata:
            child_metadata = {
                **(self._parent_metadata or {}),
                **(metadata or {}),
            }

        return Logwell(
            child_config,
            _queue=self._queue,
            _parent_metadata=child_metadata,
        )

    def _merge_metadata(
        self,
        entry_metadata: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Merge parent metadata with entry metadata.

        Args:
            entry_metadata: Metadata from the log entry

        Returns:
            Merged metadata dict, or None if neither exists
        """
        if not self._parent_metadata and not entry_metadata:
            return None
        return {
            **(self._parent_metadata or {}),
            **(entry_metadata or {}),
        }
