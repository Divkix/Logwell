"""Source location capture for adding file/line info to log entries."""

from __future__ import annotations

import sys
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

    Uses direct frame walking (sys._getframe) instead of inspect.stack()
    to avoid per-frame file I/O overhead.

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
        # skip_frames=0 → caller of this function (1 frame above us)
        frame = sys._getframe(skip_frames + 1)
        return SourceLocation(
            source_file=frame.f_code.co_filename,
            line_number=frame.f_lineno,
        )
    except (ValueError, AttributeError):
        return None
