---
spec: python-sdk
phase: research
created: 2026-01-16T00:00:00Z
generated: auto
---

# Research: Python SDK

## Executive Summary

Port TypeScript SDK to Python with full API parity. Uses `httpx` for async HTTP, `threading.Timer` for flush intervals, and `inspect` module for source location capture. High feasibility - standard Python patterns map directly to TypeScript implementation.

## Codebase Analysis

### TypeScript SDK Structure (Reference Implementation)

| Module | Purpose | Python Equivalent |
|--------|---------|-------------------|
| `client.ts` | Main Logwell class, log methods, child loggers | `client.py` - identical API |
| `types.ts` | TypedDict/Literal types | `types.py` - typing module |
| `config.ts` | Validation, defaults, API key regex | `config.py` - same logic |
| `errors.ts` | LogwellError class, error codes | `errors.py` - Exception subclass |
| `queue.ts` | BatchQueue with timer-based flush | `queue.py` - threading.Timer |
| `transport.ts` | HTTP transport with retry/backoff | `transport.py` - httpx async |
| `source-location.ts` | Stack frame parsing | `source_location.py` - inspect |

### Existing Patterns

1. **TypeScript API Surface** (`sdks/typescript/src/client.ts:56-234`)
   - Constructor with config validation
   - Log level methods: `debug`, `info`, `warn`, `error`, `fatal`
   - Generic `log()` method
   - `flush()` and `shutdown()` async methods
   - `child()` for nested loggers with context inheritance

2. **Queue Management** (`sdks/typescript/src/queue.ts:30-157`)
   - Timer-based auto-flush
   - Batch size threshold triggering
   - Queue overflow (drop oldest)
   - Re-queue on failure
   - Concurrent flush prevention

3. **Error Handling** (`sdks/typescript/src/transport.ts:115-129`)
   - Error codes: NETWORK_ERROR, UNAUTHORIZED, VALIDATION_ERROR, RATE_LIMITED, SERVER_ERROR, QUEUE_OVERFLOW, INVALID_CONFIG
   - Retryable flag per error type
   - Exponential backoff with jitter

### Dependencies

| Python Package | Purpose | Alternative |
|---------------|---------|-------------|
| `httpx` | Async HTTP client | `aiohttp` (heavier) |
| `pytest` | Testing framework | - |
| `pytest-asyncio` | Async test support | - |
| `respx` | HTTP mocking for httpx | `pytest-httpx` |
| `ruff` | Linting/formatting | `black` + `flake8` |
| `mypy` | Type checking | `pyright` |

### Constraints

1. **Python 3.9+ minimum** - `typing.Literal`, `|` union syntax (3.10+), `typing.TypedDict`
2. **Async/sync duality** - SDK must work in both sync and async contexts
3. **No runtime dependencies** except `httpx` - keep SDK lightweight
4. **Thread safety** - Queue must handle concurrent access
5. **GIL considerations** - Timer-based flush runs in separate thread

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | Direct 1:1 mapping to TS patterns |
| Effort Estimate | M | ~15-20 tasks, 3-5 days |
| Risk Level | Low | Standard Python async patterns |

### Technical Mapping

| TypeScript | Python |
|------------|--------|
| `interface LogEntry` | `TypedDict` or `dataclass` |
| `type LogLevel` | `Literal['debug', 'info', ...]` |
| `setTimeout`/`clearTimeout` | `threading.Timer` |
| `fetch()` | `httpx.AsyncClient.post()` |
| `Promise<T>` | `async/await`, `asyncio.Future` |
| `Error.stack` | `inspect.stack()` |
| `class X { private y }` | `_y` naming convention |

## Recommendations

1. **Use `httpx`** - Modern, async-native HTTP client, better than `requests` for async
2. **Use `threading.Lock`** - For thread-safe queue operations
3. **Support both sync/async** - Provide `flush()` and `async flush()` variants
4. **Use `inspect.stack()`** - More reliable than parsing `traceback` strings
5. **Use `pyproject.toml`** - Modern Python packaging standard
6. **Target Python 3.9+** - Broadest compatibility with modern typing
