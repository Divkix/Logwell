from __future__ import annotations

import inspect
import os
from dataclasses import FrozenInstanceError

import pytest

from logwell.source_location import SourceLocation, capture_source_location


class TestSourceLocationDataclass:
    def test_has_source_file_attribute(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)
        assert hasattr(loc, "source_file")
        assert loc.source_file == "/path/to/file.py"

    def test_has_line_number_attribute(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)
        assert hasattr(loc, "line_number")
        assert loc.line_number == 42

    def test_source_file_is_string(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=1)
        assert isinstance(loc.source_file, str)

    def test_line_number_is_int(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=100)
        assert isinstance(loc.line_number, int)

    def test_is_frozen_immutable(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)

        with pytest.raises(FrozenInstanceError):
            loc.source_file = "/other/path.py"  # type: ignore[misc]

        with pytest.raises(FrozenInstanceError):
            loc.line_number = 99  # type: ignore[misc]

    def test_equality_same_values(self) -> None:
        loc1 = SourceLocation(source_file="/path/to/file.py", line_number=42)
        loc2 = SourceLocation(source_file="/path/to/file.py", line_number=42)
        assert loc1 == loc2

    def test_equality_different_file(self) -> None:
        loc1 = SourceLocation(source_file="/path/to/file1.py", line_number=42)
        loc2 = SourceLocation(source_file="/path/to/file2.py", line_number=42)
        assert loc1 != loc2

    def test_equality_different_line(self) -> None:
        loc1 = SourceLocation(source_file="/path/to/file.py", line_number=42)
        loc2 = SourceLocation(source_file="/path/to/file.py", line_number=43)
        assert loc1 != loc2

    def test_repr_contains_values(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=42)
        repr_str = repr(loc)

        assert "SourceLocation" in repr_str
        assert "/path/to/file.py" in repr_str
        assert "42" in repr_str

    def test_accepts_relative_path(self) -> None:
        loc = SourceLocation(source_file="relative/path.py", line_number=1)
        assert loc.source_file == "relative/path.py"

    def test_accepts_absolute_path(self) -> None:
        loc = SourceLocation(source_file="/absolute/path/file.py", line_number=1)
        assert loc.source_file == "/absolute/path/file.py"

    def test_accepts_line_number_one(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=1)
        assert loc.line_number == 1

    def test_accepts_large_line_number(self) -> None:
        loc = SourceLocation(source_file="/path/to/file.py", line_number=999999)
        assert loc.line_number == 999999


class TestCaptureSourceLocationBasic:
    def test_returns_source_location(self) -> None:
        result = capture_source_location(0)
        assert isinstance(result, SourceLocation)

    def test_returns_this_file(self) -> None:
        result = capture_source_location(0)
        assert result is not None
        assert "test_source_location.py" in result.source_file

    def test_line_number_is_positive(self) -> None:
        result = capture_source_location(0)
        assert result is not None
        assert result.line_number > 0

    def test_captures_correct_line(self) -> None:
        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result = capture_source_location(0)

        assert result is not None
        assert result.line_number == expected_line

    def test_file_path_exists(self) -> None:
        result = capture_source_location(0)
        assert result is not None
        assert os.path.exists(result.source_file)


def helper_depth_1() -> SourceLocation | None:
    return capture_source_location(1)


def helper_depth_0() -> SourceLocation | None:
    return capture_source_location(0)


def outer_caller() -> tuple[SourceLocation | None, int]:
    expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
    result = helper_depth_1()
    return result, expected_line


def deeply_nested_call() -> SourceLocation | None:
    return capture_source_location(2)


def nested_intermediate() -> SourceLocation | None:
    return deeply_nested_call()


def nested_outer() -> tuple[SourceLocation | None, int]:
    expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
    result = nested_intermediate()
    return result, expected_line


class TestCaptureSourceLocationFrameDepth:
    def test_skip_frames_zero_captures_immediate_caller(self) -> None:
        result = helper_depth_0()
        assert result is not None
        assert "test_source_location.py" in result.source_file

    def test_skip_frames_one_captures_callers_caller(self) -> None:
        result, expected_line = outer_caller()
        assert result is not None
        assert result.line_number == expected_line

    def test_skip_frames_two_captures_two_levels_up(self) -> None:
        result, expected_line = nested_outer()
        assert result is not None
        assert result.line_number == expected_line

    def test_captures_caller_not_sdk_internals(self) -> None:
        result = capture_source_location(0)
        assert result is not None

        assert "source_location.py" not in result.source_file or "test_" in result.source_file
        assert "test_source_location.py" in result.source_file


class TestCaptureSourceLocationInvalidFrames:
    def test_excessive_skip_frames_returns_none(self) -> None:
        result = capture_source_location(10000)
        assert result is None

    def test_skip_frames_at_stack_boundary_returns_none(self) -> None:
        stack_depth = len(inspect.stack())

        result = capture_source_location(stack_depth)
        assert result is None

    def test_negative_skip_frames_behaves_safely(self) -> None:
        result = capture_source_location(-1)
        assert result is not None
        assert "source_location.py" in result.source_file

    def test_skip_frames_very_negative_returns_none(self) -> None:
        result = capture_source_location(-10000)
        assert result is None or isinstance(result, SourceLocation)


class TestCaptureSourceLocationEdgeCases:
    def test_multiple_calls_return_correct_lines(self) -> None:
        line1 = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result1 = capture_source_location(0)
        line2 = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result2 = capture_source_location(0)

        assert result1 is not None
        assert result2 is not None
        assert result1.line_number == line1
        assert result2.line_number == line2

    def test_called_from_class_method(self) -> None:
        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        result = capture_source_location(0)

        assert result is not None
        assert result.line_number == expected_line
        assert "test_source_location.py" in result.source_file

    def test_called_from_lambda(self) -> None:
        get_location = lambda: capture_source_location(0)  # noqa: E731
        result = get_location()

        assert result is not None
        assert "test_source_location.py" in result.source_file

    def test_called_from_list_comprehension(self) -> None:
        results = [capture_source_location(0) for _ in range(3)]

        assert all(r is not None for r in results)
        for r in results:
            assert r is not None
            assert "test_source_location.py" in r.source_file

    def test_returns_absolute_path(self) -> None:
        result = capture_source_location(0)
        assert result is not None
        assert os.path.isabs(result.source_file)


class TestCaptureSourceLocationExceptionHandling:
    def test_handles_index_error_gracefully(self) -> None:
        result = capture_source_location(999999)
        assert result is None

    def test_returns_none_not_raises(self) -> None:
        test_cases = [
            100,  # Too high
            1000,  # Way too high
            10000,  # Extremely high
        ]

        for skip in test_cases:
            result = capture_source_location(skip)
            assert result is None or isinstance(result, SourceLocation)


class TestSourceLocationIntegration:
    def test_typical_logging_usage_pattern(self) -> None:

        def mock_log_function(message: str) -> SourceLocation | None:
            return capture_source_location(1)

        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        location = mock_log_function("test message")

        assert location is not None
        assert location.line_number == expected_line
        assert "test_source_location.py" in location.source_file

    def test_nested_logging_wrapper_pattern(self) -> None:

        def inner_log(message: str) -> SourceLocation | None:
            return capture_source_location(2)

        def outer_log(message: str) -> SourceLocation | None:
            return inner_log(message)

        expected_line = inspect.currentframe().f_lineno + 1  # type: ignore[union-attr]
        location = outer_log("test message")

        assert location is not None
        assert location.line_number == expected_line

    def test_source_location_can_be_serialized(self) -> None:
        result = capture_source_location(0)
        assert result is not None

        location_dict = {
            "source_file": result.source_file,
            "line_number": result.line_number,
        }

        assert isinstance(location_dict["source_file"], str)
        assert isinstance(location_dict["line_number"], int)
