"""Unit tests for errors.py - LogwellErrorCode and LogwellError.

Tests cover:
- LogwellErrorCode: All 7 error codes exist with correct values
- LogwellError: Construction, attributes, inheritance from Exception
- LogwellError: __str__ and __repr__ methods
- LogwellError: Default values for optional attributes
"""

from __future__ import annotations

import pytest

from logwell.errors import LogwellError, LogwellErrorCode

# =============================================================================
# LogwellErrorCode Tests
# =============================================================================


class TestLogwellErrorCode:
    """Tests for LogwellErrorCode enum."""

    def test_network_error_exists(self) -> None:
        """NETWORK_ERROR code exists."""
        assert hasattr(LogwellErrorCode, "NETWORK_ERROR")

    def test_network_error_value(self) -> None:
        """NETWORK_ERROR has correct string value."""
        assert LogwellErrorCode.NETWORK_ERROR.value == "NETWORK_ERROR"

    def test_unauthorized_exists(self) -> None:
        """UNAUTHORIZED code exists."""
        assert hasattr(LogwellErrorCode, "UNAUTHORIZED")

    def test_unauthorized_value(self) -> None:
        """UNAUTHORIZED has correct string value."""
        assert LogwellErrorCode.UNAUTHORIZED.value == "UNAUTHORIZED"

    def test_validation_error_exists(self) -> None:
        """VALIDATION_ERROR code exists."""
        assert hasattr(LogwellErrorCode, "VALIDATION_ERROR")

    def test_validation_error_value(self) -> None:
        """VALIDATION_ERROR has correct string value."""
        assert LogwellErrorCode.VALIDATION_ERROR.value == "VALIDATION_ERROR"

    def test_rate_limited_exists(self) -> None:
        """RATE_LIMITED code exists."""
        assert hasattr(LogwellErrorCode, "RATE_LIMITED")

    def test_rate_limited_value(self) -> None:
        """RATE_LIMITED has correct string value."""
        assert LogwellErrorCode.RATE_LIMITED.value == "RATE_LIMITED"

    def test_server_error_exists(self) -> None:
        """SERVER_ERROR code exists."""
        assert hasattr(LogwellErrorCode, "SERVER_ERROR")

    def test_server_error_value(self) -> None:
        """SERVER_ERROR has correct string value."""
        assert LogwellErrorCode.SERVER_ERROR.value == "SERVER_ERROR"

    def test_queue_overflow_exists(self) -> None:
        """QUEUE_OVERFLOW code exists."""
        assert hasattr(LogwellErrorCode, "QUEUE_OVERFLOW")

    def test_queue_overflow_value(self) -> None:
        """QUEUE_OVERFLOW has correct string value."""
        assert LogwellErrorCode.QUEUE_OVERFLOW.value == "QUEUE_OVERFLOW"

    def test_invalid_config_exists(self) -> None:
        """INVALID_CONFIG code exists."""
        assert hasattr(LogwellErrorCode, "INVALID_CONFIG")

    def test_invalid_config_value(self) -> None:
        """INVALID_CONFIG has correct string value."""
        assert LogwellErrorCode.INVALID_CONFIG.value == "INVALID_CONFIG"

    def test_error_code_count(self) -> None:
        """Exactly 7 error codes are defined."""
        assert len(LogwellErrorCode) == 7

    def test_all_codes_are_strings(self) -> None:
        """All error codes inherit from str."""
        for code in LogwellErrorCode:
            assert isinstance(code, str)
            assert isinstance(code.value, str)

    def test_error_code_string_comparison(self) -> None:
        """Error codes can be compared as strings."""
        assert LogwellErrorCode.NETWORK_ERROR == "NETWORK_ERROR"
        assert LogwellErrorCode.UNAUTHORIZED == "UNAUTHORIZED"

    def test_error_codes_are_unique(self) -> None:
        """All error code values are unique."""
        values = [code.value for code in LogwellErrorCode]
        assert len(values) == len(set(values))


# =============================================================================
# LogwellError Construction Tests
# =============================================================================


class TestLogwellErrorConstruction:
    """Tests for LogwellError construction."""

    def test_basic_construction(self) -> None:
        """Error can be constructed with required arguments."""
        error = LogwellError(
            message="Test error",
            code=LogwellErrorCode.NETWORK_ERROR,
        )
        assert error.message == "Test error"
        assert error.code == LogwellErrorCode.NETWORK_ERROR

    def test_construction_with_all_arguments(self) -> None:
        """Error can be constructed with all arguments."""
        error = LogwellError(
            message="Rate limited",
            code=LogwellErrorCode.RATE_LIMITED,
            status_code=429,
            retryable=True,
        )
        assert error.message == "Rate limited"
        assert error.code == LogwellErrorCode.RATE_LIMITED
        assert error.status_code == 429
        assert error.retryable is True

    def test_default_status_code_is_none(self) -> None:
        """Default status_code is None."""
        error = LogwellError(
            message="Test",
            code=LogwellErrorCode.VALIDATION_ERROR,
        )
        assert error.status_code is None

    def test_default_retryable_is_false(self) -> None:
        """Default retryable is False."""
        error = LogwellError(
            message="Test",
            code=LogwellErrorCode.VALIDATION_ERROR,
        )
        assert error.retryable is False

    def test_retryable_true(self) -> None:
        """Retryable can be set to True."""
        error = LogwellError(
            message="Network timeout",
            code=LogwellErrorCode.NETWORK_ERROR,
            retryable=True,
        )
        assert error.retryable is True

    def test_retryable_false_explicit(self) -> None:
        """Retryable can be explicitly set to False."""
        error = LogwellError(
            message="Invalid config",
            code=LogwellErrorCode.INVALID_CONFIG,
            retryable=False,
        )
        assert error.retryable is False

    def test_status_code_401(self) -> None:
        """Status code 401 for unauthorized."""
        error = LogwellError(
            message="Invalid API key",
            code=LogwellErrorCode.UNAUTHORIZED,
            status_code=401,
        )
        assert error.status_code == 401

    def test_status_code_500(self) -> None:
        """Status code 500 for server error."""
        error = LogwellError(
            message="Internal server error",
            code=LogwellErrorCode.SERVER_ERROR,
            status_code=500,
        )
        assert error.status_code == 500

    def test_status_code_503(self) -> None:
        """Status code 503 for service unavailable."""
        error = LogwellError(
            message="Service unavailable",
            code=LogwellErrorCode.SERVER_ERROR,
            status_code=503,
        )
        assert error.status_code == 503

    def test_empty_message(self) -> None:
        """Error can be created with empty message."""
        error = LogwellError(
            message="",
            code=LogwellErrorCode.NETWORK_ERROR,
        )
        assert error.message == ""

    def test_message_with_special_chars(self) -> None:
        """Error message can contain special characters."""
        msg = "Error: 'test' with \"quotes\" and <brackets> & ampersand"
        error = LogwellError(
            message=msg,
            code=LogwellErrorCode.VALIDATION_ERROR,
        )
        assert error.message == msg

    def test_message_with_unicode(self) -> None:
        """Error message can contain unicode characters."""
        msg = "Error: 日本語 emoji 🎉 accents éàü"
        error = LogwellError(
            message=msg,
            code=LogwellErrorCode.SERVER_ERROR,
        )
        assert error.message == msg

    def test_long_message(self) -> None:
        """Error can have a long message."""
        msg = "A" * 10000
        error = LogwellError(
            message=msg,
            code=LogwellErrorCode.SERVER_ERROR,
        )
        assert error.message == msg
        assert len(error.message) == 10000


# =============================================================================
# LogwellError Inheritance Tests
# =============================================================================


class TestLogwellErrorInheritance:
    """Tests for LogwellError inheritance from Exception."""

    def test_is_exception_subclass(self) -> None:
        """LogwellError is a subclass of Exception."""
        assert issubclass(LogwellError, Exception)

    def test_instance_is_exception(self) -> None:
        """LogwellError instance is an Exception."""
        error = LogwellError(
            message="Test",
            code=LogwellErrorCode.NETWORK_ERROR,
        )
        assert isinstance(error, Exception)

    def test_can_be_raised(self) -> None:
        """LogwellError can be raised."""
        with pytest.raises(LogwellError):
            raise LogwellError(
                message="Test error",
                code=LogwellErrorCode.VALIDATION_ERROR,
            )

    def test_can_be_caught_as_exception(self) -> None:
        """LogwellError can be caught as Exception."""
        try:
            raise LogwellError(
                message="Test",
                code=LogwellErrorCode.SERVER_ERROR,
            )
        except Exception as e:
            assert isinstance(e, LogwellError)
            assert e.message == "Test"

    def test_can_be_caught_as_logwell_error(self) -> None:
        """LogwellError can be caught specifically."""
        try:
            raise LogwellError(
                message="Specific error",
                code=LogwellErrorCode.UNAUTHORIZED,
                status_code=401,
            )
        except LogwellError as e:
            assert e.code == LogwellErrorCode.UNAUTHORIZED
            assert e.status_code == 401

    def test_exception_args_preserved(self) -> None:
        """Exception args are preserved (message is first arg)."""
        error = LogwellError(
            message="Test message",
            code=LogwellErrorCode.NETWORK_ERROR,
        )
        assert error.args == ("Test message",)

    def test_is_base_exception_subclass(self) -> None:
        """LogwellError is a subclass of BaseException."""
        assert issubclass(LogwellError, BaseException)


# =============================================================================
# LogwellError __str__ Tests
# =============================================================================


class TestLogwellErrorStr:
    """Tests for LogwellError __str__ method."""

    def test_str_without_status_code(self) -> None:
        """String representation without status code."""
        error = LogwellError(
            message="Network timeout",
            code=LogwellErrorCode.NETWORK_ERROR,
        )
        assert str(error) == "[NETWORK_ERROR] Network timeout"

    def test_str_with_status_code(self) -> None:
        """String representation with status code."""
        error = LogwellError(
            message="Unauthorized request",
            code=LogwellErrorCode.UNAUTHORIZED,
            status_code=401,
        )
        assert str(error) == "[UNAUTHORIZED] Unauthorized request (HTTP 401)"

    def test_str_with_server_error(self) -> None:
        """String representation for server error."""
        error = LogwellError(
            message="Internal server error",
            code=LogwellErrorCode.SERVER_ERROR,
            status_code=500,
        )
        assert str(error) == "[SERVER_ERROR] Internal server error (HTTP 500)"

    def test_str_with_rate_limited(self) -> None:
        """String representation for rate limited error."""
        error = LogwellError(
            message="Too many requests",
            code=LogwellErrorCode.RATE_LIMITED,
            status_code=429,
        )
        assert str(error) == "[RATE_LIMITED] Too many requests (HTTP 429)"

    def test_str_validation_error(self) -> None:
        """String representation for validation error."""
        error = LogwellError(
            message="Invalid log level",
            code=LogwellErrorCode.VALIDATION_ERROR,
        )
        assert str(error) == "[VALIDATION_ERROR] Invalid log level"

    def test_str_queue_overflow(self) -> None:
        """String representation for queue overflow."""
        error = LogwellError(
            message="Queue full, logs dropped",
            code=LogwellErrorCode.QUEUE_OVERFLOW,
        )
        assert str(error) == "[QUEUE_OVERFLOW] Queue full, logs dropped"

    def test_str_invalid_config(self) -> None:
        """String representation for invalid config."""
        error = LogwellError(
            message="endpoint must be a valid URL",
            code=LogwellErrorCode.INVALID_CONFIG,
        )
        assert str(error) == "[INVALID_CONFIG] endpoint must be a valid URL"

    def test_str_empty_message(self) -> None:
        """String representation with empty message."""
        error = LogwellError(
            message="",
            code=LogwellErrorCode.NETWORK_ERROR,
        )
        assert str(error) == "[NETWORK_ERROR] "

    def test_str_with_special_chars_in_message(self) -> None:
        """String representation with special characters."""
        error = LogwellError(
            message="Error <test> & 'value'",
            code=LogwellErrorCode.VALIDATION_ERROR,
        )
        assert str(error) == "[VALIDATION_ERROR] Error <test> & 'value'"


# =============================================================================
# LogwellError __repr__ Tests
# =============================================================================


class TestLogwellErrorRepr:
    """Tests for LogwellError __repr__ method."""

    def test_repr_basic(self) -> None:
        """Repr shows all attributes."""
        error = LogwellError(
            message="Test",
            code=LogwellErrorCode.NETWORK_ERROR,
        )
        repr_str = repr(error)
        assert "LogwellError(" in repr_str
        assert "message='Test'" in repr_str
        assert "LogwellErrorCode.NETWORK_ERROR" in repr_str
        assert "status_code=None" in repr_str
        assert "retryable=False" in repr_str

    def test_repr_with_all_attributes(self) -> None:
        """Repr shows all attributes when set."""
        error = LogwellError(
            message="Rate limited",
            code=LogwellErrorCode.RATE_LIMITED,
            status_code=429,
            retryable=True,
        )
        repr_str = repr(error)
        assert "LogwellError(" in repr_str
        assert "message='Rate limited'" in repr_str
        assert "LogwellErrorCode.RATE_LIMITED" in repr_str
        assert "status_code=429" in repr_str
        assert "retryable=True" in repr_str

    def test_repr_with_status_code_500(self) -> None:
        """Repr shows status code 500."""
        error = LogwellError(
            message="Server error",
            code=LogwellErrorCode.SERVER_ERROR,
            status_code=500,
        )
        repr_str = repr(error)
        assert "status_code=500" in repr_str

    def test_repr_message_with_quotes(self) -> None:
        """Repr properly escapes quotes in message."""
        error = LogwellError(
            message="Error with 'single' quotes",
            code=LogwellErrorCode.VALIDATION_ERROR,
        )
        repr_str = repr(error)
        # Message should be repr'd (escaped)
        assert "Error with 'single' quotes" in repr_str

    def test_repr_is_valid_python(self) -> None:
        """Repr output format is consistent."""
        error = LogwellError(
            message="Test",
            code=LogwellErrorCode.UNAUTHORIZED,
            status_code=401,
            retryable=False,
        )
        repr_str = repr(error)
        # Should start with class name and have proper format
        assert repr_str.startswith("LogwellError(")
        assert repr_str.endswith(")")


# =============================================================================
# LogwellError Edge Cases
# =============================================================================


class TestLogwellErrorEdgeCases:
    """Edge case tests for LogwellError."""

    def test_status_code_zero(self) -> None:
        """Status code can be zero (unusual but valid)."""
        error = LogwellError(
            message="Test",
            code=LogwellErrorCode.NETWORK_ERROR,
            status_code=0,
        )
        # 0 is not None, so should be included in str
        assert error.status_code == 0
        assert "(HTTP 0)" in str(error)

    def test_status_code_negative(self) -> None:
        """Status code can be negative (unusual but no validation)."""
        error = LogwellError(
            message="Test",
            code=LogwellErrorCode.NETWORK_ERROR,
            status_code=-1,
        )
        assert error.status_code == -1

    def test_message_multiline(self) -> None:
        """Message can be multiline."""
        msg = "Line 1\nLine 2\nLine 3"
        error = LogwellError(
            message=msg,
            code=LogwellErrorCode.SERVER_ERROR,
        )
        assert error.message == msg
        assert "\n" in str(error)

    def test_all_error_codes_can_create_errors(self) -> None:
        """All error codes can be used to create errors."""
        for code in LogwellErrorCode:
            error = LogwellError(
                message=f"Test {code.value}",
                code=code,
            )
            assert error.code == code
            assert code.value in str(error)

    def test_error_code_in_exception_chain(self) -> None:
        """Error can be part of exception chain."""
        original = ValueError("Original error")
        try:
            try:
                raise original
            except ValueError as e:
                raise LogwellError(
                    message="Wrapped error",
                    code=LogwellErrorCode.VALIDATION_ERROR,
                ) from e
        except LogwellError as e:
            assert e.__cause__ is original
            assert e.message == "Wrapped error"

    def test_multiple_errors_independent(self) -> None:
        """Multiple error instances are independent."""
        error1 = LogwellError(
            message="Error 1",
            code=LogwellErrorCode.NETWORK_ERROR,
            status_code=None,
            retryable=True,
        )
        error2 = LogwellError(
            message="Error 2",
            code=LogwellErrorCode.SERVER_ERROR,
            status_code=500,
            retryable=False,
        )
        assert error1.message != error2.message
        assert error1.code != error2.code
        assert error1.status_code != error2.status_code
        assert error1.retryable != error2.retryable
