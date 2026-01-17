---
spec: python-sdk
phase: requirements
created: 2026-01-16T00:00:00Z
generated: auto
---

# Requirements: Python SDK

## Summary

Port TypeScript SDK to Python with identical API surface. Must support async operations, automatic batching, retry with backoff, and optional source location capture.

## User Stories

### US-1: Basic Logging

As a Python developer, I want to send structured logs to Logwell so that I can monitor my application.

**Acceptance Criteria**:
- AC-1.1: Can instantiate `Logwell` client with API key and endpoint
- AC-1.2: Can log at all levels: `debug()`, `info()`, `warn()`, `error()`, `fatal()`
- AC-1.3: Can include arbitrary metadata dict with each log
- AC-1.4: Logs include ISO8601 timestamp automatically
- AC-1.5: Can specify service name in config or per-log

### US-2: Batch Management

As a Python developer, I want logs batched automatically so that I minimize HTTP overhead.

**Acceptance Criteria**:
- AC-2.1: Logs queue until batch_size reached, then auto-flush
- AC-2.2: Logs auto-flush after flush_interval seconds if batch not full
- AC-2.3: Can manually call `flush()` to send immediately
- AC-2.4: Queue drops oldest logs when max_queue_size exceeded
- AC-2.5: `on_error` callback fires on overflow

### US-3: Graceful Shutdown

As a Python developer, I want to ensure all logs are sent before my application exits so that I don't lose telemetry.

**Acceptance Criteria**:
- AC-3.1: `shutdown()` flushes all remaining logs
- AC-3.2: `shutdown()` stops the flush timer
- AC-3.3: `shutdown()` is idempotent (safe to call multiple times)
- AC-3.4: No logs accepted after shutdown

### US-4: Child Loggers

As a Python developer, I want to create child loggers with inherited context so that I can add request-scoped metadata.

**Acceptance Criteria**:
- AC-4.1: `child()` returns new logger sharing parent's queue
- AC-4.2: Child can override service name
- AC-4.3: Child metadata merged with parent metadata
- AC-4.4: Child inherits parent's config (batch size, etc)

### US-5: Error Handling

As a Python developer, I want clear error handling so that I can debug issues with log delivery.

**Acceptance Criteria**:
- AC-5.1: `LogwellError` raised with code, message, retryable flag
- AC-5.2: Network errors are retried with exponential backoff
- AC-5.3: 401 errors marked non-retryable
- AC-5.4: 429 errors marked retryable
- AC-5.5: `on_error` callback receives exceptions

### US-6: Source Location Capture

As a Python developer, I want optional file/line info so that I can trace logs back to code.

**Acceptance Criteria**:
- AC-6.1: Disabled by default (no performance overhead)
- AC-6.2: When enabled, logs include `source_file` and `line_number`
- AC-6.3: Captures caller location, not SDK internals
- AC-6.4: Works in all log methods including `log()`

### US-7: Configuration Validation

As a Python developer, I want config validation at startup so that I catch misconfigurations early.

**Acceptance Criteria**:
- AC-7.1: API key format validated: `lw_[32 chars]`
- AC-7.2: Endpoint validated as valid URL
- AC-7.3: Numeric options validated positive/non-negative
- AC-7.4: Clear error messages on invalid config

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Client exposes debug/info/warn/error/fatal methods | Must | US-1 |
| FR-2 | Client exposes generic log() method | Must | US-1 |
| FR-3 | Logs batched by count threshold | Must | US-2 |
| FR-4 | Logs batched by time interval | Must | US-2 |
| FR-5 | Manual flush() method | Must | US-2 |
| FR-6 | Queue overflow drops oldest | Must | US-2 |
| FR-7 | shutdown() flushes and stops | Must | US-3 |
| FR-8 | child() creates scoped logger | Must | US-4 |
| FR-9 | LogwellError with error codes | Must | US-5 |
| FR-10 | Retry with exponential backoff | Must | US-5 |
| FR-11 | Source location capture | Should | US-6 |
| FR-12 | Config validation at init | Must | US-7 |
| FR-13 | queue_size property | Should | US-2 |
| FR-14 | on_flush callback | Should | US-2 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | Python 3.9+ compatibility | Compatibility |
| NFR-2 | Thread-safe queue operations | Concurrency |
| NFR-3 | Async-first with sync wrappers | API Design |
| NFR-4 | < 100KB installed size (excluding httpx) | Size |
| NFR-5 | 90%+ test coverage | Quality |
| NFR-6 | Type hints throughout | Quality |
| NFR-7 | Documented public API | Documentation |

## Out of Scope

- Sync-only fallback without httpx
- Custom serializers for metadata
- Automatic exception logging
- Integration with Python logging module
- OTLP protocol support (future)
- Compression of payloads

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| httpx | >= 0.25.0 | Async HTTP client |
| typing_extensions | >= 4.0.0 | Backport typing features (3.9) |

### Dev Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| pytest | >= 8.0.0 | Test framework |
| pytest-asyncio | >= 0.23.0 | Async test support |
| respx | >= 0.21.0 | HTTP mocking |
| mypy | >= 1.8.0 | Type checking |
| ruff | >= 0.4.0 | Linting/formatting |
| pytest-cov | >= 4.1.0 | Coverage reporting |
