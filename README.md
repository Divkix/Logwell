<p align="center">
  <img src="static/banner.png" alt="Logwell - Self-hosted logging for high-performance apps" width="100%">
</p>

<p align="center">
  <strong>Logwell</strong> is a self-hosted logging platform with real-time streaming, full-text search, and OTLP-compatible ingestion. Deploy in minutes, own your data.
</p>

<p align="center">
  <em>Alpha Software — Expect breaking changes. Not recommended for production workloads.</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/divkix/logwell/stargazers"><img src="https://img.shields.io/github/stars/divkix/logwell" alt="GitHub stars"></a>
  <a href="https://github.com/divkix/logwell/actions"><img src="https://img.shields.io/github/actions/workflow/status/divkix/logwell/ci.yml?branch=main" alt="Build Status"></a>
  <a href="https://www.npmjs.com/package/logwell"><img src="https://img.shields.io/npm/v/logwell" alt="npm version"></a>
  <a href="https://jsr.io/@divkix/logwell"><img src="https://jsr.io/badges/@divkix/logwell" alt="JSR"></a>
  <a href="https://pypi.org/project/logwell/"><img src="https://img.shields.io/pypi/v/logwell" alt="PyPI version"></a>
  <a href="https://pkg.go.dev/github.com/Divkix/Logwell/sdks/go/logwell"><img src="https://pkg.go.dev/badge/github.com/Divkix/Logwell/sdks/go/logwell.svg" alt="Go Reference"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Bun-1.0+-black?logo=bun&logoColor=white" alt="Bun">
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#usage">Usage</a> •
  <a href="#production-deployment">Deploy</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

---

## What is Logwell?

Logwell is a lightweight, self-hosted log aggregation platform for developers who want structured logging without the complexity of ELK or the costs of cloud services.

**Use Logwell when you need:**
- A simple logging backend for your side project or startup
- Full-text search across logs without managing Elasticsearch
- Real-time log streaming during development and debugging
- Complete data ownership with no vendor lock-in

**Logwell is NOT for:**
- High-volume production systems (10k+ logs/second) — use Loki or Clickhouse
- Teams needing RBAC, audit trails, or compliance features — use a managed service
- Distributed tracing or metrics — Logwell is logs-only

## Features

- **OTLP-native ingestion** — Standard OpenTelemetry protocol, no proprietary SDKs required
- **PostgreSQL backend** — Full-text search via tsvector, no separate search cluster needed
- **Real-time streaming** — SSE-powered live log tailing with batching
- **Project isolation** — Per-project API keys with separate log streams
- **Zero telemetry** — No phone-home, no tracking, fully air-gapped deployments supported
- **Clean UI** — Minimal interface with dark mode and log level color coding

## Preview

<p align="center">
  <video src="static/demo.mp4" width="100%" autoplay loop muted playsinline></video>
  <br>
  <em>Real-time log streaming demo</em>
</p>

<table>
  <tr>
    <td width="50%">
      <img src="static/logview-screen.png" alt="Log Viewer">
      <p align="center"><em>Real-time log viewer with level filtering</em></p>
    </td>
    <td width="50%">
      <img src="static/logs-view-empty.png" alt="Quick Start">
      <p align="center"><em>Quick Start with pre-filled API key</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="static/project-settings.png" alt="Project Settings">
      <p align="center"><em>API key management and code snippets</em></p>
    </td>
    <td width="50%">
      <img src="static/stats-screen.png" alt="Statistics">
      <p align="center"><em>Log level distribution analytics</em></p>
    </td>
  </tr>
</table>

## Why Logwell?

| vs | Logwell advantage |
|----|-------------------|
| Loki/Grafana | Built-in UI, no LogQL to learn, just PostgreSQL |
| ELK | Lightweight PostgreSQL backend, not Elasticsearch |
| Datadog/etc | Self-hosted, no per-GB pricing, own your data |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | SvelteKit |
| Database | PostgreSQL |
| ORM | Drizzle |
| Auth | better-auth |
| UI | shadcn-svelte + Tailwind CSS v4 |
| Real-time | Server-Sent Events |
| Runtime | Bun |

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Docker](https://docker.com) (for PostgreSQL)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/divkix/logwell.git
cd logwell

# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your values (see Environment Variables below)

# Start PostgreSQL
docker compose up -d

# Run database migrations
bun run db:migrate

# Create admin user
bun run db:seed

# Start development server
bun run dev
```

Open http://localhost:5173 and sign in with:
- **Username**: `admin` (or your `ADMIN_USERNAME` from `.env`)
- **Password**: Your `ADMIN_PASSWORD` from `.env`

> **Note:** Development runs on port **5173** (Vite). Production builds run on port **3000**.

## Environment Variables

Create a `.env` file with the following:

```env
# Database connection
DATABASE_URL="postgres://root:mysecretpassword@localhost:5432/local"

# Authentication secret (minimum 32 characters)
BETTER_AUTH_SECRET="your-32-character-secret-key-here"

# Admin user password (minimum 8 characters)
ADMIN_PASSWORD="your-admin-password"

# Admin username (optional, defaults to "admin")
# ADMIN_USERNAME="admin"

# Production URL (required for auth behind reverse proxies)
ORIGIN="https://your-domain.com"

# Log retention (optional, defaults shown)
# LOG_RETENTION_DAYS="30"        # 0 = never auto-delete
# LOG_CLEANUP_INTERVAL_MS="3600000"  # Cleanup job interval (1 hour)
```

Generate a secure secret:

```bash
openssl rand -base64 32
```

## Usage

### Create a Project

1. Sign in to the dashboard
2. Click **New Project**
3. Enter a project name
4. Copy the generated API key (`lw_...`)

### Send Logs

Logwell provides two ingestion APIs:

| API | Endpoint | Best For |
|-----|----------|----------|
| **Simple API** | `POST /v1/ingest` | Quick integration, any HTTP client |
| **OTLP API** | `POST /v1/logs` | OpenTelemetry SDKs, rich metadata |

---

#### Simple API (Recommended for quick start)

The simple API accepts flat JSON with minimal boilerplate:

```bash
curl -X POST http://localhost:5173/v1/ingest \
  -H "Authorization: Bearer lw_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"level": "info", "message": "User signed in"}'
```

**Batch multiple logs:**

```bash
curl -X POST http://localhost:5173/v1/ingest \
  -H "Authorization: Bearer lw_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    {"level": "info", "message": "Request started"},
    {"level": "error", "message": "Database timeout", "metadata": {"query": "SELECT..."}}
  ]'
```

**Available fields:**

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `level` | Yes | `debug` \| `info` \| `warn` \| `error` \| `fatal` | Log severity |
| `message` | Yes | string | Log message |
| `timestamp` | No | ISO8601 string | Defaults to current time |
| `service` | No | string | Service name for filtering |
| `metadata` | No | object | Additional structured data |

<details>
<summary><strong>Node.js (no SDK needed)</strong></summary>

```javascript
await fetch('http://localhost:5173/v1/ingest', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer lw_YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ level: 'info', message: 'Hello from Node.js' })
});
```

</details>

<details>
<summary><strong>Python (no SDK needed)</strong></summary>

```python
import requests

requests.post('http://localhost:5173/v1/ingest',
    headers={'Authorization': 'Bearer lw_YOUR_API_KEY'},
    json={'level': 'info', 'message': 'Hello from Python'})
```

</details>

<details>
<summary><strong>Go (no SDK needed)</strong></summary>

```go
body := []byte(`{"level": "info", "message": "Hello from Go"}`)
req, _ := http.NewRequest("POST", "http://localhost:5173/v1/ingest", bytes.NewBuffer(body))
req.Header.Set("Authorization", "Bearer lw_YOUR_API_KEY")
req.Header.Set("Content-Type", "application/json")
http.DefaultClient.Do(req)
```

</details>

---

#### TypeScript/JavaScript SDK

For Node.js, browsers, and edge runtimes (Cloudflare Workers, etc.):

```bash
npm install logwell
```

```typescript
import { Logwell } from 'logwell';

const logger = new Logwell({
  apiKey: 'lw_YOUR_API_KEY',
  endpoint: 'http://localhost:5173',
});

// Log at different levels
logger.info('User signed in', { userId: '123' });
logger.error('Database failed', { host: 'db.local' });

// Flush before shutdown
await logger.shutdown();
```

Features: Zero dependencies, automatic batching, retry with backoff, TypeScript-first, opt-in source location capture.

> **Deno users:** Install from JSR with `deno add jsr:@divkix/logwell` and import from `@divkix/logwell`

[Full SDK documentation →](./sdks/typescript/README.md)

---

#### Python SDK

For Python applications with automatic batching and retries:

```bash
pip install logwell
```

```python
import asyncio
from logwell import Logwell

client = Logwell({
    'api_key': 'lw_YOUR_API_KEY',
    'endpoint': 'http://localhost:5173',
    'service': 'my-app',
})

# Log at different levels
client.info('User signed in', {'user_id': '123'})
client.error('Database failed', {'host': 'db.local'})

# Flush before shutdown
asyncio.run(client.shutdown())
```

Features: Async batching, automatic retries with backoff, child loggers, typed errors, source location capture.

[Full SDK documentation →](./sdks/python/README.md)

---

#### Go SDK

For Go applications with zero external dependencies:

```bash
go get github.com/Divkix/Logwell/sdks/go
```

```go
package main

import (
    "context"
    "log"

    "github.com/Divkix/Logwell/sdks/go/logwell"
)

func main() {
    client, err := logwell.New(
        "http://localhost:5173",
        "lw_YOUR_API_KEY",
        logwell.WithService("my-app"),
    )
    if err != nil {
        log.Fatal(err)
    }

    // Log at different levels
    client.Info("User signed in", logwell.M{"userId": "123"})
    client.Error("Database failed", logwell.M{"host": "db.local"})

    // Flush before shutdown
    if err := client.Shutdown(context.Background()); err != nil {
        log.Printf("Shutdown error: %v", err)
    }
}
```

Features: Zero dependencies, automatic batching, retry with backoff, child loggers, source location capture.

[Full SDK documentation →](./sdks/go/README.md)

---

#### OTLP API (For OpenTelemetry Users)

For applications already using OpenTelemetry, point your OTLP log exporter to `POST /v1/logs` with your API key in the `Authorization` header.

<details>
<summary><strong>Node.js / TypeScript</strong></summary>

```bash
npm install @opentelemetry/exporter-logs-otlp-http @opentelemetry/sdk-logs
```

```typescript
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

const exporter = new OTLPLogExporter({
  url: 'http://localhost:5173/v1/logs',
  headers: { 'Authorization': 'Bearer lw_YOUR_API_KEY' },
});

const loggerProvider = new LoggerProvider();
loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter));
```

</details>

<details>
<summary><strong>Python</strong></summary>

```bash
pip install opentelemetry-exporter-otlp-proto-http
```

```python
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

exporter = OTLPLogExporter(
    endpoint="http://localhost:5173/v1/logs",
    headers={"Authorization": "Bearer lw_YOUR_API_KEY"},
)

logger_provider = LoggerProvider()
logger_provider.add_log_record_processor(BatchLogRecordProcessor(exporter))
```

</details>

<details>
<summary><strong>Go</strong></summary>

```bash
go get go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp
```

```go
import (
    "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
    "go.opentelemetry.io/otel/sdk/log"
)

exporter, _ := otlploghttp.New(ctx,
    otlploghttp.WithEndpointURL("http://localhost:5173/v1/logs"),
    otlploghttp.WithHeaders(map[string]string{
        "Authorization": "Bearer lw_YOUR_API_KEY",
    }),
)

processor := log.NewBatchProcessor(exporter)
provider := log.NewLoggerProvider(log.WithProcessor(processor))
```

</details>

<details>
<summary><strong>Java</strong></summary>

```xml
<!-- Maven -->
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
</dependency>
```

```java
import io.opentelemetry.exporter.otlp.http.logs.OtlpHttpLogRecordExporter;

OtlpHttpLogRecordExporter exporter = OtlpHttpLogRecordExporter.builder()
    .setEndpoint("http://localhost:5173/v1/logs")
    .addHeader("Authorization", "Bearer lw_YOUR_API_KEY")
    .build();
```

</details>

<details>
<summary><strong>C# / .NET</strong></summary>

```bash
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
```

```csharp
using OpenTelemetry;
using OpenTelemetry.Exporter;

builder.Logging.AddOpenTelemetry(logging =>
    logging.AddOtlpExporter(options =>
    {
        options.Endpoint = new Uri("http://localhost:5173/v1/logs");
        options.Protocol = OtlpExportProtocol.HttpProtobuf;
        options.Headers = "Authorization=Bearer lw_YOUR_API_KEY";
    }));
```

</details>

### OTLP Attribute Mapping

Logwell derives some UI fields from common OTLP log attributes (if present):

| UI field | Preferred OTLP attribute keys |
|----------|-------------------------------|
| `sourceFile` | `code.filepath`, `source.file` |
| `lineNumber` | `code.lineno`, `source.line` |
| `requestId` | `request.id`, `http.request_id` |
| `userId` | `enduser.id`, `user.id` |
| `ipAddress` | `client.address`, `net.peer.ip`, `net.sock.peer.addr` |

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server |
| `bun run build` | Build for production |
| `bun run preview` | Preview production build |
| `bun run check` | Run TypeScript checks |
| `bun run lint` | Run linter |
| `bun run lint:fix` | Fix lint issues |

### Database

| Command | Description |
|---------|-------------|
| `bun run db:start` | Start PostgreSQL via Docker |
| `bun run db:push` | Push schema to database (dev only; prefer `db:migrate`) |
| `bun run db:generate` | Generate migration files |
| `bun run db:migrate` | Run migrations |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run db:seed` | Create admin user |

### Testing

| Command | Description |
|---------|-------------|
| `bun run test` | Run all tests |
| `bun run test:unit` | Run unit tests |
| `bun run test:integration` | Run integration tests |
| `bun run test:component` | Run component tests |
| `bun run test:e2e` | Run E2E tests (Playwright) |
| `bun run test:coverage` | Run tests with coverage |
| `bun run test:ui` | Open Vitest UI |

## Production Deployment

### One-Click Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/XYBrph?referralCode=Divkix)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/divkix/logwell)

**Fly.io:** Clone the repo and run `fly launch` (uses included `fly.toml`)

> **Note:** PostgreSQL database required. Railway has $5/mo free credit. Render free tier expires after 30 days (paid plans from $7/mo). Fly.io offers 1GB free PostgreSQL.

### Docker Compose (Recommended)

The easiest way to deploy Logwell with PostgreSQL:

```bash
# Set required environment variables
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD="your-secure-admin-password"

# Optional: Set custom DB password (only needed if exposing port 5432 for backups)
# export DB_PASSWORD="your-db-password"

# Start the full stack
docker compose -f compose.prod.yaml up -d

# View logs
docker compose -f compose.prod.yaml logs -f app

# Stop the stack
docker compose -f compose.prod.yaml down
```

### Docker (App Only)

If you have an external PostgreSQL database:

#### Using Pre-built Image

```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/divkix/logwell:latest

# Run the container
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e BETTER_AUTH_SECRET="your-32-char-secret" \
  -e ADMIN_PASSWORD="your-admin-password" \
  -e NODE_ENV=production \
  ghcr.io/divkix/logwell:latest
```

#### Building Locally

```bash
# Build the image
docker build -t logwell .

# Run the container
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e BETTER_AUTH_SECRET="your-32-char-secret" \
  -e ADMIN_PASSWORD="your-admin-password" \
  -e NODE_ENV=production \
  logwell
```

### Health Check

The app exposes a health check endpoint for monitoring:

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-01-02T12:00:00.000Z",
  "uptime": 3600,
  "version": "0.1.2"
}
```

- Returns `200 OK` when healthy
- Returns `503 Service Unavailable` when database is down

### Manual

```bash
bun run build
bun ./build/index.js
```

The app runs on port 3000 by default.

## API Reference

### Health (Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check with database status |

### Log Ingestion (API Key Auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/ingest` | POST | Simple JSON log ingestion |
| `/v1/logs` | POST | OTLP/HTTP JSON log export |

### Project Management (Session Auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List all projects |
| `/api/projects` | POST | Create project |
| `/api/projects/[id]` | GET | Get project details |
| `/api/projects/[id]` | PATCH | Update project (name, retention) |
| `/api/projects/[id]` | DELETE | Delete project |
| `/api/projects/[id]/regenerate` | POST | Regenerate API key |
| `/api/projects/[id]/logs` | GET | Query logs |
| `/api/projects/[id]/logs/stream` | POST | SSE stream |
| `/api/projects/[id]/stats` | GET | Level distribution |

## Current Limitations

> **Important:** Logwell is alpha software. Evaluate these limitations before deploying.

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Single-user auth** | No team collaboration | Share credentials (not recommended) |
| **No log export** | Can't backup to S3/file | Direct database dumps via `pg_dump` |
| **No rate limiting** | API keys have unlimited access | Implement at reverse proxy level |

## Security

- **Always use TLS** — Run behind a reverse proxy (nginx, Caddy) with HTTPS in production
- **Protect API keys** — Treat `lw_*` keys as secrets; they grant write access to your logs
- **Network isolation** — Consider firewall rules to restrict `/v1/logs` access to known sources

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Database connection refused | Ensure PostgreSQL is running: `docker compose up -d` |
| Admin seed fails | Check `ADMIN_PASSWORD` is at least 8 characters |
| Auth errors | Verify `BETTER_AUTH_SECRET` is at least 32 characters |
| Port 5432 in use | Stop other PostgreSQL instances or change port in `compose.yaml` |

## Badge

Using Logwell? Add the badge to your project:

```markdown
[![Powered by Logwell](https://img.shields.io/badge/Powered%20by-Logwell-111111?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMTUiIGZpbGw9IndoaXRlIi8+PHJlY3QgeD0iMTI4IiB5PSIxNDgiIHdpZHRoPSIyNTYiIGhlaWdodD0iNDgiIHJ4PSIyNCIgZmlsbD0iIzExMTExMSIvPjxyZWN0IHg9IjEyOCIgeT0iMjI4IiB3aWR0aD0iMjU2IiBoZWlnaHQ9IjQ4IiByeD0iMjQiIGZpbGw9IiMxMTExMTEiIGZpbGwtb3BhY2l0eT0iMC42Ii8+PHJlY3QgeD0iMTI4IiB5PSIzMDgiIHdpZHRoPSIxNjAiIGhlaWdodD0iNDgiIHJ4PSIyNCIgZmlsbD0iIzExMTExMSIgZmlsbC1vcGFjaXR5PSIwLjI1Ii8+PC9zdmc+)](https://github.com/divkix/logwell)
```

[![Powered by Logwell](https://img.shields.io/badge/Powered%20by-Logwell-111111?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMTUiIGZpbGw9IndoaXRlIi8+PHJlY3QgeD0iMTI4IiB5PSIxNDgiIHdpZHRoPSIyNTYiIGhlaWdodD0iNDgiIHJ4PSIyNCIgZmlsbD0iIzExMTExMSIvPjxyZWN0IHg9IjEyOCIgeT0iMjI4IiB3aWR0aD0iMjU2IiBoZWlnaHQ9IjQ4IiByeD0iMjQiIGZpbGw9IiMxMTExMTEiIGZpbGwtb3BhY2l0eT0iMC42Ii8+PHJlY3QgeD0iMTI4IiB5PSIzMDgiIHdpZHRoPSIxNjAiIGhlaWdodD0iNDgiIHJ4PSIyNCIgZmlsbD0iIzExMTExMSIgZmlsbC1vcGFjaXR5PSIwLjI1Ii8+PC9zdmc+)](https://github.com/divkix/logwell)

## Contributing

Contributions are welcome! Here's how to get started:

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/logwell.git
cd logwell

# Install dependencies
bun install

# Start dev environment
docker compose up -d
bun run db:migrate
bun run dev
```

**Before submitting a PR:**
- Run `bun run check` (TypeScript)
- Run `bun run lint` (Biome)
- Run `bun run test` (Vitest)
- Use conventional commits (`feat:`, `fix:`, `docs:`, etc.)

**Report bugs:** [GitHub Issues](https://github.com/divkix/logwell/issues)

## License

[MIT](LICENSE)
