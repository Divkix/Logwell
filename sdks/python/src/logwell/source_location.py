"""Source location capture for adding file/line info to log entries."""

from __future__ import annotations

import inspect
from dataclasses import dataclass


@dataclass(frozen=True)
class SourceLocation:
    """Source location information captured from call stack.

    Attributes:
        source_file: Absolute path to the source file
        line_number: Line number in the source file
    """

    source_file: str
    line_number: int


def capture_source_location(skip_frames: int = 0) -> SourceLocation | None:
    """Capture the source location of the caller.

    Uses Python's inspect module to get the call stack and extract
    the file path and line number of the caller.

    Args:
        skip_frames: Number of stack frames to skip (0 = immediate caller
            of this function). Typically you'd use skip_frames=1 to get
            the caller of the function that calls capture_source_location.

    Returns:
        SourceLocation with source_file and line_number, or None if
        capture fails (e.g., skipFrames exceeds stack depth).

    Example:
        # In a logging function that calls this
        def log(message: str) -> None:
            location = capture_source_location(1)  # Skip log() frame
            # location.source_file = file where log() was called
    """
    try:
        # inspect.stack() returns list of FrameInfo objects
        # Index 0 is this function (capture_source_location)
        # Index 1 is the immediate caller
        # So we need index 1 + skip_frames
        stack = inspect.stack()

        # Target frame: skip capture_source_location frame + user-specified frames
        target_index = 1 + skip_frames

        if target_index >= len(stack):
            return None

        frame_info = stack[target_index]

        return SourceLocation(
            source_file=frame_info.filename,
            line_number=frame_info.lineno,
        )
    except (IndexError, AttributeError):
        return None
