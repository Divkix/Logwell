---
spec: go-sdk
phase: research
created: 2026-01-16
generated: auto
---

# Research: Go SDK for Logwell

## Executive Summary

Port TypeScript/Python SDKs to idiomatic Go. Both existing SDKs have identical architecture: client, config validation, batch queue, HTTP transport with retries, source location capture. Go's concurrency model and stdlib make this straightforward. High feasibility, minimal external dependencies.

## Existing SDK Analysis

### TypeScript SDK (`sdks/typescript/`)

| File | Purpose | Key APIs |
|------|---------|----------|
| client.ts | Main client class | `Logwell`, `child()`, `debug/info/warn/error/fatal()`, `flush()`, `shutdown()` |
| config.ts | Validation + defaults | `validateConfig()`, `validateApiKeyFormat()`, `DEFAULT_CONFIG` |
| types.ts | Type definitions | `LogEntry`, `LogwellConfig`, `LogLevel`, `IngestResponse` |
| errors.ts | Custom error class | `LogwellError`, `LogwellErrorCode` enum |
| queue.ts | Batch queue | `BatchQueue`, auto-flush by size/time, overflow protection |
| transport.ts | HTTP client | `HttpTransport`, exponential backoff retries |
| source-location.ts | Stack trace parsing | `captureSourceLocation()`, regex parsers |

### Python SDK (`sdks/python/`)

Same structure, async/await pattern. Uses `httpx` for HTTP, `threading.Timer` for queue flush timer. Key differences:
- Snake_case field names in API (`api_key`, `flush_interval`, etc.)
- Float seconds for intervals (vs milliseconds in TS)
- dataclasses for structured data

### Shared API Contract

**Log Levels**: `debug`, `info`, `warn`, `error`, `fatal`

**LogEntry Structure**:
```json
{
  "level": "info",
  "message": "string",
  "timestamp": "ISO8601",
  "service": "optional-string",
  "metadata": {"key": "value"},
  "sourceFile": "optional-string",
  "lineNumber": 123
}
```

**Config Options**:
| Option | Default | Description |
|--------|---------|-------------|
| apiKey | required | Format: `lw_[32 chars]` |
| endpoint | required | Server URL |
| service | optional | Default service name |
| batchSize | 50 | Logs before auto-flush |
| flushInterval | 5s | Time-based auto-flush |
| maxQueueSize | 1000 | Overflow threshold |
| maxRetries | 3 | Retry attempts |
| captureSourceLocation | false | Stack trace capture |
| onError | nil | Error callback |
| onFlush | nil | Flush callback |

**IngestResponse**:
```json
{
  "accepted": 10,
  "rejected": 0,
  "errors": []
}
```

## Go SDK Design Considerations

### Idiomatic Go Patterns

| TS/Python Pattern | Go Equivalent |
|-------------------|---------------|
| `class Logwell` | `type Client struct` |
| `new Logwell(config)` | `logwell.New(config)` or `logwell.NewClient(config)` |
| Optional params | Functional options pattern OR config struct |
| Callbacks | `chan error`, `func` fields |
| async/await | goroutines + channels |
| setTimeout | `time.AfterFunc` or `time.Ticker` |

### Concurrency Model

- Queue: Use `sync.Mutex` or channel-based queue
- Timer: `time.Ticker` for periodic flush
- HTTP: `net/http` stdlib, no external deps
- Shutdown: `context.Context` for cancellation

### Error Handling

- Custom error type with code: `type Error struct { Code ErrorCode; ... }`
- Sentinel errors or error wrapping with `errors.Is`/`errors.As`

### Source Location

Go has `runtime.Caller()` which provides file/line info natively. Much simpler than JS stack parsing.

```go
_, file, line, ok := runtime.Caller(skip)
```

## Dependencies

| Dependency | Purpose | Notes |
|------------|---------|-------|
| stdlib only | HTTP, concurrency, time | No external deps needed |

Optionally consider:
- `go.uber.org/zap` integration (future enhancement)
- `slog` integration (Go 1.21+, future enhancement)

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | Go stdlib covers all needs |
| Effort Estimate | M | ~1500-2000 LOC including tests |
| Risk Level | Low | Well-understood patterns |

## Constraints

1. **Go version**: Target 1.21+ for better generics/slog compatibility
2. **Zero external deps**: Use only stdlib for core functionality
3. **Context support**: All blocking operations must accept `context.Context`
4. **Goroutine safety**: All public methods must be safe for concurrent use

## Recommendations

1. Use functional options pattern for config (common Go idiom)
2. Return `error` from all operations that can fail
3. Use `context.Context` for `Flush()` and `Shutdown()`
4. Make `New()` return `(*Client, error)` to validate config at construction
5. Expose `runtime.Caller` skip parameter for source location (unlike TS/Python)
