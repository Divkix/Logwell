# sv-logger

A self-hosted logging platform with real-time log streaming, full-text search, and per-project API key authentication.

## Features

- **Real-time streaming** - SSE-powered live log updates
- **Full-text search** - Search across log messages and metadata
- **Per-project API keys** - Isolated logging for multiple applications
- **Log levels** - debug, info, warn, error, fatal with color coding
- **Standard ingestion (OTLP/HTTP)** - Send logs using the OpenTelemetry Protocol (OTLP) `/v1/logs` endpoint
- **Clean UI** - Minimal, responsive interface with dark mode

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
git clone https://github.com/divkix/sv-logger.git
cd sv-logger

# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your values (see Environment Variables below)

# Start PostgreSQL
docker compose up -d

# Push database schema
bun run db:push

# Create admin user
bun run db:seed

# Start development server
bun run dev
```

Open http://localhost:5173 and sign in with:
- **Email**: `admin@example.com`
- **Password**: Your `ADMIN_PASSWORD` from `.env`

## Environment Variables

Create a `.env` file with the following:

```env
# Database connection
DATABASE_URL="postgres://root:mysecretpassword@localhost:5432/local"

# Authentication secret (minimum 32 characters)
BETTER_AUTH_SECRET="your-32-character-secret-key-here"

# Admin user password (minimum 8 characters)
ADMIN_PASSWORD="your-admin-password"
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
4. Copy the generated API key (`svl_...`)

### Send Logs

sv-logger accepts logs via **OTLP/HTTP JSON** at `POST /v1/logs`.

```bash
curl -X POST http://localhost:5173/v1/logs \
  -H "Authorization: Bearer svl_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [
      {
        "resource": {
          "attributes": [
            { "key": "service.name", "value": { "stringValue": "my-service" } }
          ]
        },
        "scopeLogs": [
          {
            "scope": { "name": "sv-logger" },
            "logRecords": [
              {
                "severityNumber": 9,
                "severityText": "INFO",
                "body": { "stringValue": "User signed in" }
              }
            ]
          }
        ]
      }
    ]
  }'
```

### OTLP Attribute Mapping

sv-logger derives some UI fields from common OTLP log attributes (if present):

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
| `bun run db:push` | Push schema to database |
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
| `bun run test:e2e` | Run E2E tests (Playwright) |
| `bun run test:coverage` | Run tests with coverage |

## Production Deployment

### Docker Compose (Recommended)

The easiest way to deploy sv-logger with PostgreSQL:

```bash
# Set required environment variables
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export DB_PASSWORD="your-secure-db-password"

# Start the full stack
docker compose -f compose.prod.yaml up -d

# View logs
docker compose -f compose.prod.yaml logs -f app

# Stop the stack
docker compose -f compose.prod.yaml down
```

### Docker (App Only)

If you have an external PostgreSQL database:

```bash
# Build the image
docker build -t sv-logger .

# Run the container
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e BETTER_AUTH_SECRET="your-32-char-secret" \
  -e NODE_ENV=production \
  sv-logger
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
  "version": "0.0.1"
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
| `/v1/logs` | POST | OTLP/HTTP JSON log export |

### Project Management (Session Auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List all projects |
| `/api/projects` | POST | Create project |
| `/api/projects/[id]` | GET | Get project details |
| `/api/projects/[id]` | DELETE | Delete project |
| `/api/projects/[id]/regenerate` | POST | Regenerate API key |
| `/api/projects/[id]/logs` | GET | Query logs |
| `/api/projects/[id]/logs/stream` | POST | SSE stream |
| `/api/projects/[id]/stats` | GET | Level distribution |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Database connection refused | Ensure PostgreSQL is running: `docker compose up -d` |
| Admin seed fails | Check `ADMIN_PASSWORD` is at least 8 characters |
| Auth errors | Verify `BETTER_AUTH_SECRET` is at least 32 characters |
| Port 5432 in use | Stop other PostgreSQL instances or change port in `compose.yaml` |

## License

MIT
