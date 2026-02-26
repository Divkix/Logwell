# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**Log Ingestion:**
- Simple JSON API at `POST /v1/ingest`
  - SDK/Client: None (HTTP only)
  - Auth: API Key via `Authorization: Bearer lw_*` header
  - Format: Single log or batch array
  - Location: `src/routes/v1/ingest/+server.ts`

- OTLP (OpenTelemetry) HTTP Exporter at `POST /v1/logs`
  - SDK/Client: Any OTLP-compatible exporter
  - Auth: API Key via `Authorization: Bearer lw_*` header
  - Format: OTLP JSON Protobuf mapping
  - Location: `src/routes/v1/logs/+server.ts`

**Health Monitoring:**
- Health check endpoint at `GET /api/health`
  - No authentication required
  - Returns HTTP 200 if database is healthy
  - Location: `src/routes/api/health/+server.ts`

## Data Storage

**Databases:**
- PostgreSQL 15+
  - Connection: `DATABASE_URL` environment variable
  - Format: `postgresql://user:password@host:port/database`
  - Client: postgres.js 3.4.8 (driver)
  - ORM: Drizzle ORM 0.45.1
  - Features:
    - Full-text search via PostgreSQL `tsvector` on log messages
    - Incident fingerprinting for error grouping
    - GIN indexes for fast text search
    - Cascade deletion for projects and logs
  - Tables defined in `src/lib/server/db/schema.ts`:
    - `project` - Project metadata and API keys
    - `log` - Log entries with OTLP fields
    - `incident` - Grouped error incidents
    - `user` - User accounts (better-auth)
    - `session` - Authentication sessions (better-auth)
    - `account` - OAuth provider accounts (better-auth)
    - `verification` - Email verification tokens (better-auth)

**File Storage:**
- Local filesystem only
  - No cloud storage integration
  - Log data stored in PostgreSQL, not files
  - Build artifacts go to `build/` directory (excluded from version control)

**Caching:**
- None (direct database queries)
- In-memory event bus for real-time log streaming (not persistent)
  - Location: `src/lib/server/events.ts`
  - Used only for active SSE connections

## Authentication & Identity

**Auth Provider:**
- Self-hosted with better-auth 1.4.19
  - Email/password authentication
  - Username plugin for additional credentials
  - Session-based (7-day expiration, updates every 24 hours)
  - No OAuth integrations (extensible via better-auth plugins)

**Implementation:**
- Server-side session creation in `src/lib/server/auth.ts`
- Client-side auth client in `src/lib/auth-client.ts` (Svelte store-based)
- Session middleware in `src/hooks.server.ts`
- Tables created by better-auth via Drizzle adapter:
  - `user`, `session`, `account`, `verification`

**Authorization:**
- Project ownership verification for all project operations
- API key authentication for log ingestion (`lw_` prefix)
- Session-based for web UI
- Utilities in `src/lib/server/utils/project-guard.ts`

## Monitoring & Observability

**Error Tracking:**
- None integrated
- Errors logged to console (development) or stderr (production)
- Application health check endpoint available at `GET /api/health`

**Logs:**
- Managed by the application itself
- Structured logging via console.log/error (no external service)
- Log rotation/retention handled by `LOG_RETENTION_DAYS` config
- Automatic cleanup via background job (runs every `LOG_CLEANUP_INTERVAL_MS`)

**Metrics:**
- Statistics endpoints for project analysis:
  - `GET /api/projects/[id]/stats` - Summary statistics
  - `GET /api/projects/[id]/stats/timeseries` - Time-series data
  - Location: `src/routes/api/projects/[id]/stats*`
  - No external metrics service

## CI/CD & Deployment

**Hosting:**
- Docker containerization via `compose.prod.yaml`
- Base image: Bun runtime (via `ghcr.io/divkix/logwell:dev`)
- Database: PostgreSQL 18-alpine service in same compose stack
- Self-hosted or any container orchestration platform (Kubernetes, Docker Swarm, etc.)

**CI Pipeline:**
- GitHub Actions (detected via `playwright.config.ts` CI checks)
- E2E test runner configured for CI:
  - Port: 4173 (production build preview)
  - Retry: 2 times on failure
  - Workers: 1 (serial execution)
  - Browsers: Chromium, Firefox
  - Reporting: GitHub Actions format

**Build Process:**
- Vite production build: `bun run build`
- Preview mode: `bun run preview`
- Database migrations: `drizzle-kit push` or `drizzle-kit migrate`

## Environment Configuration

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - 32+ character secret for session encryption (required in production)

**Optional Environment Variables:**
- `ADMIN_PASSWORD` - Initial admin password (min 8 chars, used by seed script)
- `ORIGIN` - Production URL for CORS and trusted origins (e.g., `https://logs.example.com`)
- `NODE_ENV` - Environment mode (`development` or `production`)

**Performance Tuning Variables:**
- `SSE_BATCH_WINDOW_MS` - SSE event batching window (100-10000ms, default: 1500ms)
- `SSE_MAX_BATCH_SIZE` - Max logs per batch before flush (1-500, default: 50)
- `SSE_HEARTBEAT_INTERVAL_MS` - Keep-alive ping interval (5000-300000ms, default: 30000ms)
- `LOG_STREAM_MAX_LOGS` - Max logs in memory per client (1-10000, default: 1000)
- `LOG_RETENTION_DAYS` - Auto-delete logs after N days (0 = disabled, default: 30)
- `LOG_CLEANUP_INTERVAL_MS` - Cleanup job interval (60000-86400000ms, default: 3600000ms/1h)
- `INCIDENT_AUTO_RESOLVE_MINUTES` - Minutes before incident marked resolved (1-10080, default: 30)

**Secrets Storage:**
- Configured via `.env` file (never committed)
- Example template: `.env.example` (checked in, no secrets)
- Production: Set via environment variables or secrets management system

**Configuration Validation:**
- Startup validation in `src/lib/server/config/env.ts`
- Throws `EnvValidationError` if required variables missing or invalid
- Masked logging via `getEnvSummary()` for safe debugging

## Webhooks & Callbacks

**Incoming Webhooks:**
- None currently implemented
- Log ingestion via HTTP APIs only (not webhook callbacks)

**Outgoing Webhooks:**
- None implemented
- Real-time updates delivered via Server-Sent Events (SSE) to connected clients
- SSE endpoints:
  - `GET /api/projects/[id]/logs/stream` - Real-time log stream
  - `GET /api/projects/[id]/incidents/stream` - Real-time incident updates
  - Location: `src/routes/api/projects/[id]/*/stream/+server.ts`
  - Format: Server-Sent Events with JSON payloads

## API Key Management

**API Key Structure:**
- Prefix: `lw_` (for "Logwell")
- Storage: `project.apiKey` in PostgreSQL
- Index: `idx_project_api_key` for fast lookup
- Validation: `src/lib/server/utils/api-key.ts`

**API Key Endpoints:**
- Generate/create: `POST /api/projects` (when project created)
- Regenerate: `POST /api/projects/[id]/regenerate` - Creates new key, invalidates old
- Usage: `Authorization: Bearer lw_xxx` header in log ingestion requests

**Key Rotation:**
- Supported via regenerate endpoint
- Old key immediately invalidated
- No automatic rotation

---

*Integration audit: 2026-02-26*
