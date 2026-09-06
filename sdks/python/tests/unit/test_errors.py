from __future__ import annotations

from logwell.errors import LogwellError, LogwellErrorCode


def test_error_taxonomy_contract() -> None:
    """Error taxonomy is pinned by the TS reference SDK; one smoke case proves
    the Python mirror carries all 7 codes with the shared str format."""
    assert len(LogwellErrorCode) == 7
    for code in LogwellErrorCode:
        error = LogwellError(message="probe", code=code)
        assert error.code == code
        assert code.value in str(error)
    assert (
        str(
            LogwellError(
                message="Too many requests",
                code=LogwellErrorCode.RATE_LIMITED,
                status_code=429,
            )
        )
        == "[RATE_LIMITED] Too many requests (HTTP 429)"
    )
