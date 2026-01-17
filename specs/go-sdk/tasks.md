---
spec: go-sdk
phase: tasks
total_tasks: 18
created: 2026-01-16
generated: auto
---

# Tasks: Go SDK for Logwell

## Phase 1: Make It Work (POC)

Focus: End-to-end log sending works. Skip tests, accept hardcoded values where expedient.

- [x] 1.1 Initialize Go module and basic structure
  - **Do**: Create `sdks/go/` directory, `go.mod` with module path `github.com/Divkix/Logwell/sdks/go`, create `logwell/` package dir
  - **Files**: `sdks/go/go.mod`, `sdks/go/logwell/doc.go`
  - **Done when**: `go build ./...` passes in `sdks/go/`
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): initialize Go module structure`
  - _Requirements: FR-1_
  - _Design: File Structure_

- [x] 1.2 Create core types
  - **Do**: Define `LogLevel` constants, `LogEntry` struct, `IngestResponse` struct with JSON tags
  - **Files**: `sdks/go/logwell/types.go`
  - **Done when**: Types compile, JSON marshaling works
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add core types (LogEntry, LogLevel, IngestResponse)`
  - _Requirements: FR-2, FR-3_
  - _Design: Types_

- [x] 1.3 Create error types
  - **Do**: Define `ErrorCode` constants, `Error` struct with `Code`, `Message`, `StatusCode`, `Retryable` fields, implement `error` interface
  - **Files**: `sdks/go/logwell/errors.go`
  - **Done when**: Error type implements `error`, can be created and formatted
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add custom Error type with codes`
  - _Requirements: FR-17_
  - _Design: Error Types_

- [x] 1.4 Create HTTP transport (minimal)
  - **Do**: Create `httpTransport` struct with `send(ctx, []LogEntry)` method. POST to `/v1/ingest` with Bearer auth. No retries yet.
  - **Files**: `sdks/go/logwell/transport.go`
  - **Done when**: Can POST JSON to endpoint and parse response
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add HTTP transport (no retry)`
  - _Requirements: FR-11_
  - _Design: HttpTransport_

- [x] 1.5 Create batch queue (minimal)
  - **Do**: Create `batchQueue` with `add()`, `flush()`, `size()`. No timer yet, no overflow. Simple mutex-protected slice.
  - **Files**: `sdks/go/logwell/queue.go`
  - **Done when**: Can add entries and flush them
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add batch queue (basic)`
  - _Requirements: FR-4_
  - _Design: BatchQueue_

- [x] 1.6 Create client (minimal)
  - **Do**: Create `Client` struct, `New(endpoint, apiKey)` constructor, `Info()` method. Wire up queue and transport. Auto-flush on batch size.
  - **Files**: `sdks/go/logwell/client.go`
  - **Done when**: `client.Info("msg")` queues log, batch flushes when size reached
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add Client with basic Info() method`
  - _Requirements: FR-1, FR-2, FR-4_
  - _Design: Client_

- [x] 1.7 POC Checkpoint - Manual integration test
  - **Do**: Create `sdks/go/examples/basic/main.go` that sends logs to a real/mock server. Verify logs appear.
  - **Files**: `sdks/go/examples/basic/main.go`
  - **Done when**: Example compiles and sends logs (verify with server or request inspection)
  - **Verify**: `cd sdks/go && go build ./examples/basic/`
  - **Commit**: `feat(go-sdk): complete POC with basic example`
  - _Requirements: AC-1.1, AC-1.2, AC-1.3, AC-1.4_
  - _Design: API Examples_

## Phase 2: Refactoring and Feature Completion

After POC validated, add remaining features and clean up code.

- [x] 2.1 Add config validation and functional options
  - **Do**: Implement `Option` type, all `With*` functions, `validateConfig()` with API key regex and URL validation. Update `New()` to accept options.
  - **Files**: `sdks/go/logwell/config.go`, `sdks/go/logwell/client.go`
  - **Done when**: All config options work, invalid config returns error
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add functional options and config validation`
  - _Requirements: FR-1, FR-18, FR-19, AC-6.1, AC-6.2, AC-6.3, AC-6.4_
  - _Design: Config_

- [x] 2.2 Add all log level methods
  - **Do**: Implement `Debug()`, `Warn()`, `Error()`, `Fatal()`, `Log(entry)`. All should accept variadic metadata.
  - **Files**: `sdks/go/logwell/client.go`
  - **Done when**: All 5 level methods work plus generic `Log()`
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add all log level methods`
  - _Requirements: FR-2, FR-3, AC-1.2_
  - _Design: Client_

- [x] 2.3 Add retry logic with exponential backoff
  - **Do**: Add retry loop to transport with exponential backoff + jitter. Classify errors as retryable/non-retryable.
  - **Files**: `sdks/go/logwell/transport.go`
  - **Done when**: Network errors and 5xx retry, 401/400 do not
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add retry with exponential backoff`
  - _Requirements: FR-11, FR-12, AC-7.1, AC-7.2, AC-7.3, AC-7.4, AC-7.5_
  - _Design: HttpTransport_

- [x] 2.4 Add timer-based auto-flush
  - **Do**: Add `time.Timer` to queue that triggers flush after `flushInterval`. Reset on each add, stop on flush.
  - **Files**: `sdks/go/logwell/queue.go`
  - **Done when**: Logs auto-flush after interval even if batch size not reached
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add timer-based auto-flush`
  - _Requirements: FR-5_
  - _Design: BatchQueue_

- [x] 2.5 Add queue overflow protection
  - **Do**: When queue exceeds `maxQueueSize`, drop oldest entry and call `onError` callback
  - **Files**: `sdks/go/logwell/queue.go`
  - **Done when**: Overflow drops oldest, callback invoked
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add queue overflow protection`
  - _Requirements: FR-13, AC-8.1, AC-8.2, AC-8.3_
  - _Design: BatchQueue_

- [x] 2.6 Add shutdown and flush with context
  - **Do**: Implement `Shutdown(ctx)` and `Flush(ctx)` with context cancellation support. Ensure graceful drain.
  - **Files**: `sdks/go/logwell/client.go`, `sdks/go/logwell/queue.go`
  - **Done when**: Shutdown flushes remaining logs, respects context timeout
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add Shutdown and Flush with context support`
  - _Requirements: FR-6, FR-7, AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-5.1, AC-5.2, AC-5.3_
  - _Design: Client, BatchQueue_

- [x] 2.7 Add child logger
  - **Do**: Implement `Child()` with `ChildOption` for metadata and service override. Child shares parent queue.
  - **Files**: `sdks/go/logwell/client.go`
  - **Done when**: Child loggers work with inherited and merged metadata
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add child logger support`
  - _Requirements: FR-8, AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5_
  - _Design: Client_

- [x] 2.8 Add source location capture
  - **Do**: Implement `captureSource(skip)` using `runtime.Caller()`. Add to log entries when `CaptureSourceLocation` enabled.
  - **Files**: `sdks/go/logwell/source.go`, `sdks/go/logwell/client.go`
  - **Done when**: Logs include sourceFile and lineNumber when enabled
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add source location capture`
  - _Requirements: FR-14, AC-9.1, AC-9.2, AC-9.3_
  - _Design: Source Location_

- [x] 2.9 Add callbacks (onError, onFlush)
  - **Do**: Wire up `OnError` and `OnFlush` callbacks from config. Ensure they're called in non-blocking manner.
  - **Files**: `sdks/go/logwell/queue.go`, `sdks/go/logwell/client.go`
  - **Done when**: Callbacks fire on errors and successful flushes
  - **Verify**: `cd sdks/go && go build ./...`
  - **Commit**: `feat(go-sdk): add error and flush callbacks`
  - _Requirements: FR-15, FR-16, AC-10.1, AC-10.2, AC-10.3_
  - _Design: Config, BatchQueue_

## Phase 3: Testing

- [x] 3.1 Unit tests for config validation
  - **Do**: Test API key validation, URL validation, numeric bounds, default values
  - **Files**: `sdks/go/logwell/config_test.go`
  - **Done when**: Tests cover all validation paths
  - **Verify**: `cd sdks/go && go test ./logwell/ -run TestConfig -v`
  - **Commit**: `test(go-sdk): add config validation tests`
  - _Requirements: AC-6.1, AC-6.2, AC-6.3_

- [x] 3.2 Unit tests for transport and retry
  - **Do**: Test retry behavior, backoff, error classification using httptest
  - **Files**: `sdks/go/logwell/transport_test.go`
  - **Done when**: Tests verify retry on 5xx, no retry on 401
  - **Verify**: `cd sdks/go && go test ./logwell/ -run TestTransport -v`
  - **Commit**: `test(go-sdk): add transport and retry tests`
  - _Requirements: AC-7.1, AC-7.2, AC-7.3_

- [x] 3.3 Unit tests for queue
  - **Do**: Test batch flush, timer flush, overflow, re-queue on failure
  - **Files**: `sdks/go/logwell/queue_test.go`
  - **Done when**: Tests cover all queue behaviors
  - **Verify**: `cd sdks/go && go test ./logwell/ -run TestQueue -v`
  - **Commit**: `test(go-sdk): add queue tests`
  - _Requirements: AC-8.1, AC-8.2_

- [x] 3.4 Integration tests for client
  - **Do**: Test full flow: create client, log, flush, shutdown using httptest server
  - **Files**: `sdks/go/logwell/client_test.go`
  - **Done when**: Full integration flow covered
  - **Verify**: `cd sdks/go && go test ./logwell/ -run TestClient -v`
  - **Commit**: `test(go-sdk): add client integration tests`
  - _Requirements: AC-1.1, AC-1.4, AC-4.1_

## Phase 4: Quality Gates

- [x] 4.1 Add README and documentation
  - **Do**: Create README.md with installation, usage examples, API reference
  - **Files**: `sdks/go/README.md`
  - **Done when**: README covers all major features with examples
  - **Verify**: Review README manually
  - **Commit**: `docs(go-sdk): add README with usage examples`

- [x] 4.2 Local quality check
  - **Do**: Run `go vet`, `go test -race`, ensure no warnings
  - **Verify**: `cd sdks/go && go vet ./... && go test -race ./logwell/`
  - **Done when**: No vet warnings, tests pass with race detector
  - **Commit**: `fix(go-sdk): address vet warnings` (if needed)

- [x] 4.3 Update main README
  - **Do**: Add Go SDK to main project README alongside TS/Python
  - **Files**: `README.md`
  - **Done when**: Go SDK listed in main README
  - **Verify**: Review README manually
  - **Commit**: `docs: add Go SDK to main README`

- [x] 4.4 Create PR and verify CI
  - **Do**: Push branch, create PR with gh CLI, verify CI passes
  - **Verify**: `gh pr checks --watch` all green
  - **Done when**: PR ready for review
  - **Commit**: N/A (PR creation)

## Notes

- **POC shortcuts taken**: No retry, no timer, no overflow, no options
- **Production TODOs fixed in Phase 2**: All features added, code cleaned up
- **Test strategy**: Unit tests for each component, integration test for full flow
