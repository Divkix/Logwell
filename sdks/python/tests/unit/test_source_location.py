from __future__ import annotations

import inspect

from logwell.source_location import SourceLocation, capture_source_location


def test_wrapper_skip_frames_pin_caller_location() -> None:
    """Source capture shape is pinned by the TS reference SDK; one case proves
    the Python frame-skip contract (SDK internals are skipped, caller wins)."""

    def mock_log_function(message: str) -> SourceLocation | None:
        return capture_source_location(1)

    expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
    location = mock_log_function("test message")

    assert location is not None
    assert location.line_number == expected_line
    assert "test_source_location.py" in location.source_file
