---
spec: go-sdk
phase: requirements
created: 2026-01-16
generated: auto
---

# Requirements: Go SDK for Logwell

## Summary

Provide Go developers with a Logwell SDK that has feature parity with TypeScript/Python SDKs while following idiomatic Go conventions.

## User Stories

### US-1: Basic Logging

As a Go developer, I want to send logs to Logwell at different severity levels so that I can monitor my application.

**Acceptance Criteria**:
- AC-1.1: Can create client with API key and endpoint
- AC-1.2: Can call `Debug()`, `Info()`, `Warn()`, `Error()`, `Fatal()` methods
- AC-1.3: Each log includes timestamp, level, message
- AC-1.4: Logs are batched and sent automatically

### US-2: Structured Logging

As a Go developer, I want to attach metadata to my logs so that I can add context for debugging.

**Acceptance Criteria**:
- AC-2.1: Can pass `map[string]any` as metadata to any log method
- AC-2.2: Metadata is serialized as JSON in the log entry
- AC-2.3: Can set default service name in config

### US-3: Child Loggers

As a Go developer, I want to create child loggers with inherited context so that I can add request-scoped metadata.

**Acceptance Criteria**:
- AC-3.1: Can call `Child()` to create derived logger
- AC-3.2: Child inherits parent's queue (shared batching)
- AC-3.3: Child can override service name
- AC-3.4: Child metadata merges with parent metadata
- AC-3.5: Entry metadata takes precedence over parent metadata

### US-4: Graceful Shutdown

As a Go developer, I want to flush remaining logs before my application exits so that no logs are lost.

**Acceptance Criteria**:
- AC-4.1: `Shutdown(ctx)` flushes all queued logs
- AC-4.2: Shutdown respects context cancellation/timeout
- AC-4.3: After shutdown, new logs are silently dropped
- AC-4.4: Shutdown is idempotent

### US-5: Manual Flush

As a Go developer, I want to manually trigger a flush so that I can ensure logs are sent before critical operations.

**Acceptance Criteria**:
- AC-5.1: `Flush(ctx)` sends all queued logs immediately
- AC-5.2: Returns `*IngestResponse` on success, error on failure
- AC-5.3: Respects context cancellation

### US-6: Configuration Validation

As a Go developer, I want clear errors when my configuration is invalid so that I can fix issues quickly.

**Acceptance Criteria**:
- AC-6.1: API key format validated (`lw_[32 chars]`)
- AC-6.2: Endpoint URL validated
- AC-6.3: Numeric options validated (positive values)
- AC-6.4: Errors include actionable messages

### US-7: Automatic Retry

As a Go developer, I want failed requests to be retried automatically so that transient failures don't lose logs.

**Acceptance Criteria**:
- AC-7.1: Network errors trigger retry
- AC-7.2: 429 and 5xx responses trigger retry
- AC-7.3: 401 and 400 errors do not retry
- AC-7.4: Exponential backoff with jitter between retries
- AC-7.5: Configurable max retry attempts

### US-8: Queue Overflow Protection

As a Go developer, I want the queue to handle overflow gracefully so that my application doesn't run out of memory.

**Acceptance Criteria**:
- AC-8.1: When queue exceeds max size, oldest logs are dropped
- AC-8.2: `OnError` callback notified of dropped logs
- AC-8.3: Configurable max queue size

### US-9: Source Location Capture

As a Go developer, I want to optionally capture file/line info in logs so that I can trace logs to source code.

**Acceptance Criteria**:
- AC-9.1: When enabled, logs include `sourceFile` and `lineNumber`
- AC-9.2: Disabled by default (performance consideration)
- AC-9.3: Captures correct caller location (not SDK internals)

### US-10: Error Callbacks

As a Go developer, I want to be notified of SDK errors so that I can monitor logging health.

**Acceptance Criteria**:
- AC-10.1: `OnError` callback receives all SDK errors
- AC-10.2: `OnFlush` callback receives count of successfully sent logs
- AC-10.3: Callbacks don't block logging operations

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Client construction with config validation | Must | US-1, US-6 |
| FR-2 | Log methods: Debug, Info, Warn, Error, Fatal | Must | US-1 |
| FR-3 | Log method accepting LogEntry struct directly | Must | US-1 |
| FR-4 | Automatic batching by size threshold | Must | US-1 |
| FR-5 | Automatic batching by time interval | Must | US-1 |
| FR-6 | Manual flush with context support | Must | US-5 |
| FR-7 | Graceful shutdown with context support | Must | US-4 |
| FR-8 | Child logger creation | Must | US-3 |
| FR-9 | Metadata attachment per-log | Must | US-2 |
| FR-10 | Service name in config | Should | US-2 |
| FR-11 | HTTP transport with retry logic | Must | US-7 |
| FR-12 | Exponential backoff with jitter | Must | US-7 |
| FR-13 | Queue overflow protection | Must | US-8 |
| FR-14 | Source location capture (optional) | Should | US-9 |
| FR-15 | Error callback mechanism | Should | US-10 |
| FR-16 | Flush callback mechanism | Should | US-10 |
| FR-17 | Custom error type with codes | Must | US-6 |
| FR-18 | API key format validation | Must | US-6 |
| FR-19 | Endpoint URL validation | Must | US-6 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | Zero external runtime dependencies (stdlib only) | Simplicity |
| NFR-2 | All public methods must be goroutine-safe | Concurrency |
| NFR-3 | Context support for blocking operations | Cancellation |
| NFR-4 | Go 1.21+ compatibility | Compatibility |
| NFR-5 | <10KB binary size impact | Size |
| NFR-6 | Logging methods must not block on HTTP | Performance |
| NFR-7 | Export types for IDE autocomplete | Usability |

## Out of Scope

- slog adapter (future enhancement)
- zap adapter (future enhancement)
- OpenTelemetry integration (future enhancement)
- Log file persistence (server responsibility)
- Log querying/searching (server responsibility)

## Dependencies

- Go 1.21+ runtime
- Logwell server with `/v1/ingest` endpoint
