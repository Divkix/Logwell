<p align="center">
  <img src="https://raw.githubusercontent.com/Divkix/Logwell/main/static/banner.png" alt="Logwell" width="600" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/logwell"><img src="https://img.shields.io/npm/v/logwell.svg" alt="npm version" /></a>
  <a href="https://jsr.io/@divkix/logwell"><img src="https://jsr.io/badges/@divkix/logwell" alt="JSR" /></a>
  <a href="https://www.npmjs.com/package/logwell"><img src="https://img.shields.io/npm/dm/logwell.svg" alt="npm downloads" /></a>
  <a href="https://github.com/Divkix/Logwell/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/logwell.svg" alt="license" /></a>
</p>

# logwell

Official TypeScript SDK for [Logwell](https://github.com/divkix/logwell) - a self-hosted logging platform with real-time streaming and full-text search.

## Features

- **Zero runtime dependencies** - Uses native `fetch`
- **Universal runtime support** - Node.js 18+, browsers, and edge runtimes
- **TypeScript-first** - Full type definitions included
- **Automatic batching** - Configurable batch size and flush intervals
- **Retry with backoff** - Exponential backoff on transient failures
- **Child loggers** - Request-scoped context propagation
- **Source location capture** - Opt-in file/line number tracking
- **Lightweight** - < 10KB gzipped

## Installation

### npm / bun / pnpm

```bash
npm install logwell
# or
bun add logwell
# or
pnpm add logwell
```

### JSR (Deno)

```bash
deno add jsr:@divkix/logwell
```

```typescript
import { Logwell } from '@divkix/logwell';
```

## Quick Start

```typescript
import { Logwell } from 'logwell';

const logger = new Logwell({
  apiKey: 'lw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  endpoint: 'https://logs.example.com',
  service: 'my-app',
});

// Log at different levels
logger.debug('Debug message');
logger.info('User logged in', { userId: '123' });
logger.warn('Deprecated API called');
logger.error('Database connection failed', { host: 'db.local' });
logger.fatal('Unrecoverable error');

// Flush before shutdown
await logger.shutdown();
```

## Configuration

```typescript
interface LogwellConfig {
  // Required
  apiKey: string;              // API key (format: lw_[32chars])
  endpoint: string;            // Logwell server URL

  // Optional
  service?: string;            // Default service name for all logs
  batchSize?: number;          // Logs per batch (default: 50)
  flushInterval?: number;      // Auto-flush interval in ms (default: 5000)
  maxQueueSize?: number;       // Max queue size (default: 1000)
  maxRetries?: number;         // Retry attempts (default: 3)
  captureSourceLocation?: boolean; // Capture file/line (default: false)

  // Callbacks
  onError?: (error: Error) => void;  // Called on send failures
  onFlush?: (count: number) => void; // Called after successful flush
}
```

## API Reference

### Log Methods

```typescript
logger.debug(message: string, metadata?: Record<string, unknown>): void
logger.info(message: string, metadata?: Record<string, unknown>): void
logger.warn(message: string, metadata?: Record<string, unknown>): void
logger.error(message: string, metadata?: Record<string, unknown>): void
logger.fatal(message: string, metadata?: Record<string, unknown>): void

// Generic log method
logger.log(entry: LogEntry): void
```

### Lifecycle Methods

```typescript
// Force immediate flush of queued logs
await logger.flush(): Promise<IngestResponse | null>

// Flush and stop (call before process exit)
await logger.shutdown(): Promise<void>
```

### Child Loggers

Create child loggers with additional context:

```typescript
const requestLogger = logger.child({
  service: 'api-handler',
  metadata: { requestId: req.id },
});

// All logs include requestId automatically
requestLogger.info('Request received', { path: req.path });
```

### Properties

```typescript
// Current queue size
logger.queueSize: number
```

### Source Location Capture

Enable automatic file and line number capture for debugging:

```typescript
const logger = new Logwell({
  apiKey: 'lw_xxx',
  endpoint: 'https://logs.example.com',
  captureSourceLocation: true, // opt-in
});

logger.info('User logged in');
// Log includes: sourceFile: '/app/src/auth.ts', lineNumber: 42
```

> **Note:** This feature has performance overhead (creates Error object per log). Disabled by default. Works across Node.js, Bun, and browsers.

## Usage Examples

### Express.js Middleware

```typescript
import { Logwell } from 'logwell';
import express from 'express';

const logger = new Logwell({
  apiKey: process.env.LOGWELL_API_KEY!,
  endpoint: process.env.LOGWELL_ENDPOINT!,
  service: 'express-app',
});

const app = express();

app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.log = logger.child({ metadata: { requestId } });

  const start = Date.now();
  res.on('finish', () => {
    req.log.info('Request completed', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await logger.shutdown();
  process.exit(0);
});
```

### Cloudflare Workers

```typescript
import { Logwell } from 'logwell';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const logger = new Logwell({
      apiKey: env.LOGWELL_API_KEY,
      endpoint: env.LOGWELL_ENDPOINT,
      batchSize: 1, // Immediate flush for short-lived workers
    });

    logger.info('Worker invoked', { url: request.url });

    try {
      const response = await handleRequest(request);
      await logger.flush();
      return response;
    } catch (error) {
      logger.error('Worker error', { error: String(error) });
      await logger.flush();
      throw error;
    }
  },
};
```

### Browser

```html
<script type="module">
  import { Logwell } from 'https://esm.sh/logwell';

  const logger = new Logwell({
    apiKey: 'lw_xxx',
    endpoint: 'https://logs.example.com',
    batchSize: 10,
    flushInterval: 10000,
  });

  // Log user actions
  document.getElementById('submit')?.addEventListener('click', () => {
    logger.info('Form submitted', { formId: 'signup' });
  });

  // Flush before page unload
  window.addEventListener('beforeunload', () => logger.flush());
</script>
```

## Error Handling

The SDK throws `LogwellError` on failures:

```typescript
import { Logwell, LogwellError } from 'logwell';

const logger = new Logwell({
  apiKey: 'lw_xxx',
  endpoint: 'https://logs.example.com',
  onError: (error) => {
    if (error instanceof LogwellError) {
      console.error(`Logwell error [${error.code}]: ${error.message}`);
      if (error.retryable) {
        // Will be retried automatically
      }
    }
  },
});
```

Error codes:
- `NETWORK_ERROR` - Network failure (retryable)
- `UNAUTHORIZED` - Invalid API key
- `VALIDATION_ERROR` - Invalid log format
- `RATE_LIMITED` - Too many requests (retryable)
- `SERVER_ERROR` - Server error (retryable)
- `QUEUE_OVERFLOW` - Queue full, oldest logs dropped
- `INVALID_CONFIG` - Invalid configuration

## TypeScript

Full type definitions are included:

```typescript
import type {
  Logwell,
  LogwellConfig,
  LogLevel,
  LogEntry,
  IngestResponse,
  LogwellError,
  LogwellErrorCode,
} from 'logwell';
```

## License

MIT
