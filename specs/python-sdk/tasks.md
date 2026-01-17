---
spec: python-sdk
phase: tasks
total_tasks: 22
created: 2026-01-16T00:00:00Z
generated: auto
---

# Tasks: Python SDK

## Phase 1: Make It Work (POC)

Focus: Validate Python SDK works end-to-end. Skip tests, accept minimal error handling.

- [x] 1.1 Create package structure
  - **Do**: Create `sdks/python/` directory with `pyproject.toml`, `src/logwell/__init__.py`, empty module files
  - **Files**: `sdks/python/pyproject.toml`, `sdks/python/src/logwell/__init__.py`, `sdks/python/src/logwell/py.typed`
  - **Done when**: `cd sdks/python && pip install -e .` succeeds
  - **Verify**: `python -c "import logwell; print(logwell.__version__)"`
  - **Commit**: `feat(python-sdk): scaffold package structure`
  - _Requirements: NFR-1_
  - _Design: File Structure_

- [x] 1.2 Implement types module
  - **Do**: Create `types.py` with LogLevel, LogEntry, LogwellConfig, IngestResponse TypedDicts
  - **Files**: `sdks/python/src/logwell/types.py`
  - **Done when**: Types importable, mypy passes on module
  - **Verify**: `python -c "from logwell.types import LogLevel, LogEntry"`
  - **Commit**: `feat(python-sdk): add type definitions`
  - _Requirements: FR-1, NFR-6_
  - _Design: Types_

- [x] 1.3 Implement errors module
  - **Do**: Create `errors.py` with LogwellErrorCode enum and LogwellError exception class
  - **Files**: `sdks/python/src/logwell/errors.py`
  - **Done when**: Can raise and catch LogwellError with code/message/retryable
  - **Verify**: `python -c "from logwell.errors import LogwellError, LogwellErrorCode; raise LogwellError('test', LogwellErrorCode.NETWORK_ERROR)"`
  - **Commit**: `feat(python-sdk): add error types`
  - _Requirements: FR-9_
  - _Design: Errors_

- [x] 1.4 Implement config module
  - **Do**: Create `config.py` with DEFAULT_CONFIG, API_KEY_REGEX, validate_api_key_format(), validate_config()
  - **Files**: `sdks/python/src/logwell/config.py`
  - **Done when**: Validates API key format, endpoint URL, merges defaults
  - **Verify**: `python -c "from logwell.config import validate_config; print(validate_config({'api_key': 'lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'endpoint': 'https://example.com'}))"`
  - **Commit**: `feat(python-sdk): add config validation`
  - _Requirements: FR-12, AC-7.1, AC-7.2, AC-7.3_
  - _Design: Config_

- [x] 1.5 Implement transport module
  - **Do**: Create `transport.py` with HttpTransport class, send() with retry and backoff
  - **Files**: `sdks/python/src/logwell/transport.py`
  - **Done when**: Can POST to endpoint with auth header, retries on failure
  - **Verify**: Manual test against local server or mock
  - **Commit**: `feat(python-sdk): add HTTP transport with retry`
  - _Requirements: FR-10, AC-5.2, AC-5.3, AC-5.4_
  - _Design: HttpTransport_

- [x] 1.6 Implement queue module
  - **Do**: Create `queue.py` with BatchQueue class, add(), flush(), shutdown(), timer management
  - **Files**: `sdks/python/src/logwell/queue.py`
  - **Done when**: Queues logs, auto-flushes on batch_size, timer-based flush works
  - **Verify**: Manual test with print statements
  - **Commit**: `feat(python-sdk): add batch queue with auto-flush`
  - _Requirements: FR-3, FR-4, FR-5, FR-6, AC-2.1, AC-2.2, AC-2.3, AC-2.4_
  - _Design: BatchQueue_

- [x] 1.7 Implement source_location module
  - **Do**: Create `source_location.py` with SourceLocation dataclass and capture_source_location()
  - **Files**: `sdks/python/src/logwell/source_location.py`
  - **Done when**: Returns file/line of caller, skips SDK frames
  - **Verify**: `python -c "from logwell.source_location import capture_source_location; print(capture_source_location(0))"`
  - **Commit**: `feat(python-sdk): add source location capture`
  - _Requirements: FR-11, AC-6.1, AC-6.2, AC-6.3_
  - _Design: SourceLocation_

- [x] 1.8 Implement client module
  - **Do**: Create `client.py` with Logwell class, all log methods, flush(), shutdown(), child()
  - **Files**: `sdks/python/src/logwell/client.py`
  - **Done when**: Can instantiate, log, flush, create child loggers
  - **Verify**: Manual test logging to local server
  - **Commit**: `feat(python-sdk): add Logwell client class`
  - _Requirements: FR-1, FR-2, FR-7, FR-8, AC-1.1 through AC-4.4_
  - _Design: Logwell_

- [x] 1.9 Wire up __init__.py exports
  - **Do**: Export Logwell, LogwellError, LogwellErrorCode, types from `__init__.py`
  - **Files**: `sdks/python/src/logwell/__init__.py`
  - **Done when**: `from logwell import Logwell, LogwellError` works
  - **Verify**: `python -c "from logwell import Logwell, LogwellError, LogwellErrorCode"`
  - **Commit**: `feat(python-sdk): expose public API`
  - _Requirements: NFR-7_
  - _Design: Architecture_

- [x] 1.10 POC Checkpoint
  - **Do**: Test full flow: instantiate, log, flush against mock or real server
  - **Done when**: Logs appear in server, no errors
  - **Verify**: Run manual E2E test script
  - **Commit**: `feat(python-sdk): complete POC`

## Phase 2: Refactoring

After POC validated, clean up code.

- [x] 2.1 Add thread safety to queue
  - **Do**: Add threading.Lock to BatchQueue, protect queue/timer operations
  - **Files**: `sdks/python/src/logwell/queue.py`
  - **Done when**: No race conditions under concurrent add/flush
  - **Verify**: `mypy sdks/python/src && ruff check sdks/python/src`
  - **Commit**: `refactor(python-sdk): add thread safety to queue`
  - _Requirements: NFR-2_
  - _Design: Thread Safety_

- [x] 2.2 Improve error messages
  - **Do**: Add detailed context to all LogwellError raises
  - **Files**: `sdks/python/src/logwell/*.py`
  - **Done when**: Each error includes actionable message
  - **Verify**: `mypy sdks/python/src`
  - **Commit**: `refactor(python-sdk): improve error messages`
  - _Requirements: AC-7.4_
  - _Design: Error Handling_

- [x] 2.3 Add type hints throughout
  - **Do**: Ensure all functions have full type annotations, run mypy strict
  - **Files**: `sdks/python/src/logwell/*.py`
  - **Done when**: `mypy --strict sdks/python/src` passes
  - **Verify**: `mypy --strict sdks/python/src`
  - **Commit**: `refactor(python-sdk): add strict type hints`
  - _Requirements: NFR-6_
  - _Design: Types_

- [x] 2.4 Add README and LICENSE
  - **Do**: Create README.md with usage examples, create LICENSE (MIT)
  - **Files**: `sdks/python/README.md`, `sdks/python/LICENSE`
  - **Done when**: README has install, basic usage, API reference sections
  - **Verify**: Visual inspection
  - **Commit**: `docs(python-sdk): add README and LICENSE`
  - _Requirements: NFR-7_

## Phase 3: Testing

- [x] 3.1 Create test fixtures
  - **Do**: Create conftest.py with valid/invalid configs, mock responses
  - **Files**: `sdks/python/tests/__init__.py`, `sdks/python/tests/conftest.py`
  - **Done when**: Fixtures importable in tests
  - **Verify**: `pytest sdks/python/tests --collect-only`
  - **Commit**: `test(python-sdk): add test fixtures`
  - _Design: File Structure_

- [x] 3.2 Unit tests for config
  - **Do**: Test validate_config, validate_api_key_format, edge cases
  - **Files**: `sdks/python/tests/unit/__init__.py`, `sdks/python/tests/unit/test_config.py`
  - **Done when**: 100% coverage of config.py
  - **Verify**: `pytest sdks/python/tests/unit/test_config.py -v`
  - **Commit**: `test(python-sdk): add config unit tests`
  - _Requirements: AC-7.1, AC-7.2, AC-7.3, AC-7.4_

- [x] 3.3 Unit tests for errors
  - **Do**: Test LogwellError construction, attributes, inheritance
  - **Files**: `sdks/python/tests/unit/test_errors.py`
  - **Done when**: All error codes tested
  - **Verify**: `pytest sdks/python/tests/unit/test_errors.py -v`
  - **Commit**: `test(python-sdk): add error unit tests`
  - _Requirements: FR-9_

- [x] 3.4 Unit tests for queue
  - **Do**: Test add, flush, overflow, timer, shutdown, concurrent ops
  - **Files**: `sdks/python/tests/unit/test_queue.py`
  - **Done when**: All BatchQueue methods tested
  - **Verify**: `pytest sdks/python/tests/unit/test_queue.py -v`
  - **Commit**: `test(python-sdk): add queue unit tests`
  - _Requirements: AC-2.1 through AC-2.5_

- [x] 3.5 Unit tests for source_location
  - **Do**: Test capture at different frame depths, invalid frames
  - **Files**: `sdks/python/tests/unit/test_source_location.py`
  - **Done when**: Source location capture verified
  - **Verify**: `pytest sdks/python/tests/unit/test_source_location.py -v`
  - **Commit**: `test(python-sdk): add source location tests`
  - _Requirements: AC-6.1, AC-6.2, AC-6.3_

- [x] 3.6 Unit tests for client
  - **Do**: Test all log methods, child loggers, flush, shutdown
  - **Files**: `sdks/python/tests/unit/test_client.py`
  - **Done when**: Client API fully tested
  - **Verify**: `pytest sdks/python/tests/unit/test_client.py -v`
  - **Commit**: `test(python-sdk): add client unit tests`
  - _Requirements: AC-1.1 through AC-4.4_

- [x] 3.7 Integration tests
  - **Do**: Test full flow with mocked HTTP (respx)
  - **Files**: `sdks/python/tests/integration/__init__.py`, `sdks/python/tests/integration/test_e2e.py`
  - **Done when**: E2E flow tested with mock server
  - **Verify**: `pytest sdks/python/tests/integration -v`
  - **Commit**: `test(python-sdk): add integration tests`

## Phase 4: Quality Gates

- [x] 4.1 Local quality check
  - **Do**: Run mypy, ruff, pytest with coverage
  - **Verify**: `cd sdks/python && mypy --strict src && ruff check src && pytest --cov=src --cov-report=term-missing`
  - **Done when**: All pass, coverage >= 90%
  - **Commit**: `fix(python-sdk): address lint/type issues` (if needed)

- [x] 4.2 Create PR
  - **Do**: Push branch, create PR with gh CLI
  - **Verify**: `gh pr checks --watch` all green
  - **Done when**: PR ready for review

## Notes

- **POC shortcuts taken**: Minimal error messages, no thread safety initially, manual testing only
- **Production TODOs**: Thread safety (Phase 2), comprehensive tests (Phase 3), type strictness (Phase 2)
