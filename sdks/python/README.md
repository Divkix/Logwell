# Logwell Python SDK

Official Python SDK for the [Logwell](https://github.com/Divkix/Logwell) logging platform.

## Installation

```bash
pip install logwell
```

## Quick Start

```python
import asyncio
from logwell import Logwell

# Initialize client
client = Logwell({
    'api_key': 'lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'endpoint': 'https://logs.example.com',
    'service': 'my-app',
})

# Log messages at different levels
client.debug('Debug message')
client.info('User logged in', {'user_id': '123'})
client.warn('Disk space low', {'available_gb': 5})
client.error('Failed to process request', {'request_id': 'abc'})
client.fatal('Database connection lost')

# Ensure logs are sent before exit
asyncio.run(client.shutdown())
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `api_key` | `str` | **required** | API key in format `lw_[32 chars]` |
| `endpoint` | `str` | **required** | Logwell server URL |
| `service` | `str` | `None` | Default service name for all logs |
| `batch_size` | `int` | `50` | Number of logs to batch before auto-flush |
| `flush_interval` | `float` | `5.0` | Seconds between auto-flushes |
| `max_queue_size` | `int` | `1000` | Maximum queue size before dropping oldest |
| `max_retries` | `int` | `3` | Retry attempts for failed requests |
| `capture_source_location` | `bool` | `False` | Capture file/line info |
| `on_error` | `Callable` | `None` | Error callback |
| `on_flush` | `Callable` | `None` | Flush callback |

### Example with all options

```python
from logwell import Logwell

def on_error(err):
    print(f'Logging error: {err}')

def on_flush(count):
    print(f'Flushed {count} logs')

client = Logwell({
    'api_key': 'lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'endpoint': 'https://logs.example.com',
    'service': 'my-app',
    'batch_size': 100,
    'flush_interval': 10.0,
    'max_queue_size': 5000,
    'max_retries': 5,
    'capture_source_location': True,
    'on_error': on_error,
    'on_flush': on_flush,
})
```

## API Reference

### Logwell

The main client class.

#### Constructor

```python
Logwell(config: LogwellConfig)
```

#### Methods

| Method | Description |
|--------|-------------|
| `debug(message, metadata=None)` | Log at debug level |
| `info(message, metadata=None)` | Log at info level |
| `warn(message, metadata=None)` | Log at warning level |
| `error(message, metadata=None)` | Log at error level |
| `fatal(message, metadata=None)` | Log at fatal level |
| `log(entry)` | Log with explicit LogEntry |
| `flush()` | Async: Flush queued logs immediately |
| `shutdown()` | Async: Flush and stop the client |
| `child(metadata=None, service=None)` | Create child logger with context |
| `queue_size` | Property: Current queue size |

### Child Loggers

Create child loggers to add persistent context:

```python
# Create child logger with request context
request_logger = client.child({'request_id': 'abc-123'})
request_logger.info('Processing request')  # Includes request_id

# Override service name
db_logger = client.child(service='my-app-db')
db_logger.info('Query executed', {'duration_ms': 45})
```

### Log Entry

```python
from logwell import LogLevel

# Using log() with explicit entry
client.log({
    'level': 'info',
    'message': 'Custom log',
    'metadata': {'key': 'value'},
    'service': 'override-service',
    'timestamp': '2024-01-01T00:00:00Z',  # Optional, auto-generated
})
```

### LogLevel

Available log levels: `debug`, `info`, `warn`, `error`, `fatal`

### LogwellConfig

TypedDict with configuration options. See Configuration section above.

### IngestResponse

Response from the server after flushing logs:

```python
{
    'accepted': 50,      # Logs accepted
    'rejected': 0,       # Logs rejected (optional)
    'errors': [],        # Error messages (optional)
}
```

## Error Handling

### LogwellError

All SDK errors are wrapped in `LogwellError`:

```python
from logwell import Logwell, LogwellError, LogwellErrorCode

try:
    client = Logwell({'api_key': 'invalid', 'endpoint': 'https://example.com'})
except LogwellError as e:
    print(e.message)      # Human-readable message
    print(e.code)         # LogwellErrorCode enum
    print(e.status_code)  # HTTP status (if applicable)
    print(e.retryable)    # Whether operation can be retried
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_CONFIG` | Invalid configuration value |
| `NETWORK_ERROR` | Network connectivity or timeout |
| `UNAUTHORIZED` | Invalid or expired API key (401) |
| `VALIDATION_ERROR` | Invalid request data |
| `RATE_LIMITED` | Too many requests (429) |
| `SERVER_ERROR` | Server-side error (5xx) |
| `QUEUE_OVERFLOW` | Queue exceeded max size |

### Error Callback

Handle errors without try/catch:

```python
def handle_error(err: Exception):
    if isinstance(err, LogwellError):
        if err.code == LogwellErrorCode.NETWORK_ERROR:
            print('Network issue, logs will be retried')
        elif err.code == LogwellErrorCode.QUEUE_OVERFLOW:
            print('Queue full, some logs dropped')

client = Logwell({
    'api_key': 'lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'endpoint': 'https://logs.example.com',
    'on_error': handle_error,
})
```

## Async Usage

The SDK uses async for flush and shutdown operations:

```python
import asyncio
from logwell import Logwell

async def main():
    client = Logwell({
        'api_key': 'lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'endpoint': 'https://logs.example.com',
    })

    client.info('Starting app')

    # Manual flush
    response = await client.flush()
    print(f'Sent {response["accepted"]} logs')

    # Shutdown gracefully
    await client.shutdown()

asyncio.run(main())
```

## Source Location Capture

Enable automatic file/line capture:

```python
client = Logwell({
    'api_key': 'lw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'endpoint': 'https://logs.example.com',
    'capture_source_location': True,
})

client.info('This log includes file and line number')
# Log includes: source_file='app.py', line_number=42
```

## Requirements

- Python 3.9+
- httpx >= 0.25.0

## License

MIT License - see [LICENSE](LICENSE) for details.
