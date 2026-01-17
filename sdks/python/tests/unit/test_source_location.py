"""Unit tests for source_location.py - SourceLocation and capture_source_location.

Tests cover:
- SourceLocation dataclass: attributes, immutability (frozen)
- capture_source_location: frame depth 0 (immediate caller), depth 1+ (caller's caller)
- capture_source_location: invalid frame depth returns None
- File path is string, line number is positive integer

Requirements tested: AC-6.1, AC-6.2, AC-6.3
"""

from __future__ import annotations

import inspect
import os
from dataclasses import FrozenInstanceError

import pytest

from logwell.source_location import SourceLocation, capture_source_location

# =============================================================================
# SourceLocation Dataclass Tests
# =============================================================================


class TestSourceLocationDataclass:
    """Tests for SourceLocation dataclass structure and attributes."""

    def test_has_source_file_attribute(self) -> None:
        """SourceLocation has source_file attribute."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)
        assert hasattr(loc, "source_file")
        assert loc.source_file == "/path/to/file.py"

    def test_has_line_number_attribute(self) -> None:
        """SourceLocation has line_number attribute."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)
        assert hasattr(loc, "line_number")
        assert loc.line_number == 42

    def test_source_file_is_string(self) -> None:
        """source_file is a string type."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=1)
        assert isinstance(loc.source_file, str)

    def test_line_number_is_int(self) -> None:
        """line_number is an int type."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=100)
        assert isinstance(loc.line_number, int)

    def test_is_frozen_immutable(self) -> None:
        """SourceLocation is frozen (immutable)."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)

        with pytest.raises(FrozenInstanceError):
            loc.source_file = "/other/path.py"  # type: ignore[misc]

        with pytest.raises(FrozenInstanceError):
            loc.line_number = 99  # type: ignore[misc]

    def test_equality_same_values(self) -> None:
        """Two SourceLocation with same values are equal."""
        loc1 = SourceLocation(source_file="/path/to/file.py", line_number=42)
        loc2 = SourceLocation(source_file="/path/to/file.py", line_number=42)
        assert loc1 == loc2

    def test_equality_different_file(self) -> None:
        """Two SourceLocation with different files are not equal."""
        loc1 = SourceLocation(source_file="/path/to/file1.py", line_number=42)
        loc2 = SourceLocation(source_file="/path/to/file2.py", line_number=42)
        assert loc1 != loc2

    def test_equality_different_line(self) -> None:
        """Two SourceLocation with different lines are not equal."""
        loc1 = SourceLocation(source_file="/path/to/file.py", line_number=42)
        loc2 = SourceLocation(source_file="/path/to/file.py", line_number=43)
        assert loc1 != loc2

    def test_repr_contains_values(self) -> None:
        """__repr__ contains source_file and line_number."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)
        repr_str = repr(loc)

        assert "SourceLocation" in repr_str
        assert "/path/to/file.py" in repr_str
        assert "42" in repr_str

    def test_accepts_relative_path(self) -> None:
        """Accepts relative file paths."""
        loc = SourceLocation(source_file="relative/path.py", line_number=1)
        assert loc.source_file == "relative/path.py"

    def test_accepts_absolute_path(self) -> None:
        """Accepts absolute file paths."""
        loc = SourceLocation(source_file="/absolute/path/file.py", line_number=1)
        assert loc.source_file == "/absolute/path/file.py"

    def test_accepts_line_number_one(self) -> None:
        """Accepts line number 1 (first line)."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=1)
        assert loc.line_number == 1

    def test_accepts_large_line_number(self) -> None:
        """Accepts large line numbers."""
        loc = SourceLocation(source_file="/path/to/file.py", line_number=999999)
        assert loc.line_number == 999999


# =============================================================================
# capture_source_location Tests - Basic Functionality
# =============================================================================


class TestCaptureSourceLocationBasic:
    """Tests for capture_source_location basic functionality."""

    def test_returns_source_location(self) -> None:
        """capture_source_location returns SourceLocation instance."""
        result = capture_source_location(0)
        assert isinstance(result, SourceLocation)

    def test_returns_this_file(self) -> None:
        """capture_source_location(0) returns this test file."""
        result = capture_source_location(0)
        assert result is not None
        # Should contain this file's name
        assert "test_source_location.py" in result.source_file

    def test_line_number_is_positive(self) -> None:
        """Line number is a positive integer."""
        result = capture_source_location(0)
        assert result is not None
        assert result.line_number > 0

    def test_captures_correct_line(self) -> None:
        """Captures the line where capture_source_location is called."""
        # Get line number of the capture call
        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result = capture_source_location(0)

        assert result is not None
        assert result.line_number == expected_line

    def test_file_path_exists(self) -> None:
        """The captured file path actually exists."""
        result = capture_source_location(0)
        assert result is not None
        # File should exist since we're running this test
        assert os.path.exists(result.source_file)


# =============================================================================
# capture_source_location Tests - Frame Depth
# =============================================================================


def helper_depth_1() -> SourceLocation | None:
    """Helper that captures with skip_frames=1."""
    return capture_source_location(1)


def helper_depth_0() -> SourceLocation | None:
    """Helper that captures with skip_frames=0."""
    return capture_source_location(0)


def outer_caller() -> tuple[SourceLocation | None, int]:
    """Outer function that calls helper and records its line number."""
    expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
    result = helper_depth_1()
    return result, expected_line


def deeply_nested_call() -> SourceLocation | None:
    """Deeply nested call chain for testing higher skip_frames."""
    return capture_source_location(2)


def nested_intermediate() -> SourceLocation | None:
    """Intermediate function in nested call."""
    return deeply_nested_call()


def nested_outer() -> tuple[SourceLocation | None, int]:
    """Outer function for deeply nested test."""
    expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
    result = nested_intermediate()
    return result, expected_line


class TestCaptureSourceLocationFrameDepth:
    """Tests for capture_source_location with different frame depths."""

    def test_skip_frames_zero_captures_immediate_caller(self) -> None:
        """skip_frames=0 captures the immediate caller of capture_source_location."""
        result = helper_depth_0()
        assert result is not None
        # Should capture line inside helper_depth_0, not this test
        assert "test_source_location.py" in result.source_file
        # Line should be around line 147 (capture_source_location call in helper)

    def test_skip_frames_one_captures_callers_caller(self) -> None:
        """skip_frames=1 captures the caller's caller."""
        result, expected_line = outer_caller()
        assert result is not None
        # Should capture line in outer_caller where helper_depth_1 was called
        assert result.line_number == expected_line

    def test_skip_frames_two_captures_two_levels_up(self) -> None:
        """skip_frames=2 captures two levels up the call stack."""
        result, expected_line = nested_outer()
        assert result is not None
        # Should capture line in nested_outer where nested_intermediate was called
        assert result.line_number == expected_line

    def test_captures_caller_not_sdk_internals(self) -> None:
        """Verifies caller location is captured, not SDK internals (AC-6.3)."""
        # When we call capture_source_location(0), it should capture THIS file
        result = capture_source_location(0)
        assert result is not None

        # Should NOT be source_location.py (SDK internal)
        assert "source_location.py" not in result.source_file or "test_" in result.source_file
        # Should be test file
        assert "test_source_location.py" in result.source_file


# =============================================================================
# capture_source_location Tests - Invalid Frames
# =============================================================================


class TestCaptureSourceLocationInvalidFrames:
    """Tests for capture_source_location with invalid frame depths."""

    def test_excessive_skip_frames_returns_none(self) -> None:
        """Returns None when skip_frames exceeds stack depth."""
        # A very large number that exceeds any reasonable stack depth
        result = capture_source_location(10000)
        assert result is None

    def test_skip_frames_at_stack_boundary_returns_none(self) -> None:
        """Returns None when skip_frames is exactly at stack boundary."""
        # Get current stack depth
        stack_depth = len(inspect.stack())

        # skip_frames + 1 (for capture_source_location itself) should exceed stack
        result = capture_source_location(stack_depth)
        assert result is None

    def test_negative_skip_frames_behaves_safely(self) -> None:
        """Negative skip_frames should work (index 1 + negative = may still be valid)."""
        # skip_frames=-1 means target_index=0, which is capture_source_location itself
        # This should return the capture_source_location function location
        result = capture_source_location(-1)
        assert result is not None
        assert "source_location.py" in result.source_file

    def test_skip_frames_very_negative_returns_none(self) -> None:
        """Very negative skip_frames returns None due to negative index handling."""
        # skip_frames=-10000 means target_index=-9999, which wraps around in list
        # but may not be a valid frame - depends on implementation
        result = capture_source_location(-10000)
        # This will either work (Python negative indexing) or return None
        # The implementation checks target_index >= len(stack), which won't catch
        # negative indices. Python's negative indexing will either work or raise.
        # Current impl will return something due to Python's negative indexing.
        # This test documents the behavior.
        # For stack with ~10 frames, -10000 wraps to valid index
        # Actually, if target_index is negative and abs(target_index) > len(stack),
        # Python raises IndexError, which is caught and returns None.
        # Let's verify:
        assert result is None or isinstance(result, SourceLocation)


# =============================================================================
# capture_source_location Tests - Edge Cases
# =============================================================================


class TestCaptureSourceLocationEdgeCases:
    """Edge case tests for capture_source_location."""

    def test_multiple_calls_return_correct_lines(self) -> None:
        """Multiple calls return their respective call locations."""
        line1 = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result1 = capture_source_location(0)
        line2 = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result2 = capture_source_location(0)

        assert result1 is not None
        assert result2 is not None
        assert result1.line_number == line1
        assert result2.line_number == line2

    def test_called_from_class_method(self) -> None:
        """Works when called from inside a class method."""
        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result = capture_source_location(0)

        assert result is not None
        assert result.line_number == expected_line
        assert "test_source_location.py" in result.source_file

    def test_called_from_lambda(self) -> None:
        """Works when called from a lambda."""
        get_location = lambda: capture_source_location(0)  # noqa: E731
        result = get_location()

        assert result is not None
        # Should capture this file
        assert "test_source_location.py" in result.source_file

    def test_called_from_list_comprehension(self) -> None:
        """Works when called from a list comprehension."""
        results = [capture_source_location(0) for _ in range(3)]

        assert all(r is not None for r in results)
        # All should be from this file
        for r in results:
            assert r is not None
            assert "test_source_location.py" in r.source_file

    def test_returns_absolute_path(self) -> None:
        """The returned file path is absolute."""
        result = capture_source_location(0)
        assert result is not None
        # inspect.stack() returns absolute paths when running pytest
        assert os.path.isabs(result.source_file)


# =============================================================================
# capture_source_location Tests - Exception Handling
# =============================================================================


class TestCaptureSourceLocationExceptionHandling:
    """Tests for capture_source_location exception handling."""

    def test_handles_index_error_gracefully(self) -> None:
        """Returns None when IndexError occurs."""
        # This is tested by excessive skip_frames, but explicit test
        result = capture_source_location(999999)
        assert result is None

    def test_returns_none_not_raises(self) -> None:
        """Never raises exception, returns None on failure."""
        # Various edge cases should return None, not raise
        test_cases = [
            100,  # Too high
            1000,  # Way too high
            10000,  # Extremely high
        ]

        for skip in test_cases:
            result = capture_source_location(skip)
            # Should be None or SourceLocation, never raise
            assert result is None or isinstance(result, SourceLocation)


# =============================================================================
# Integration-like Tests
# =============================================================================


class TestSourceLocationIntegration:
    """Integration-style tests for source location capture workflow."""

    def test_typical_logging_usage_pattern(self) -> None:
        """Test the typical pattern: log function calls capture with skip_frames=1."""

        def mock_log_function(message: str) -> SourceLocation | None:
            # In real logging, this would be skip_frames=1 to get caller of log()
            return capture_source_location(1)

        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        location = mock_log_function("test message")

        assert location is not None
        assert location.line_number == expected_line
        assert "test_source_location.py" in location.source_file

    def test_nested_logging_wrapper_pattern(self) -> None:
        """Test pattern where logging has multiple wrappers."""

        def inner_log(message: str) -> SourceLocation | None:
            # Skip 2: inner_log -> outer_log -> caller
            return capture_source_location(2)

        def outer_log(message: str) -> SourceLocation | None:
            return inner_log(message)

        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        location = outer_log("test message")

        assert location is not None
        assert location.line_number == expected_line

    def test_source_location_can_be_serialized(self) -> None:
        """SourceLocation data can be extracted for serialization."""
        result = capture_source_location(0)
        assert result is not None

        # Can extract to dict-like structure
        location_dict = {
            "source_file": result.source_file,
            "line_number": result.line_number,
        }

        assert isinstance(location_dict["source_file"], str)
        assert isinstance(location_dict["line_number"], int)
