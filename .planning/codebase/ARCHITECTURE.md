# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Layered MVC architecture with separation between API ingestion layer, application layer, and UI layer.

**Key Characteristics:**
- SvelteKit full-stack framework with server-side rendering
- PostgreSQL database with Drizzle ORM for type-safe queries
- In-memory event bus for real-time log streaming (not database polling)
- Project-scoped multi-tenancy with API key authentication for ingestion
- Session-based authentication for web UI via better-auth
- Real-time Server-Sent Events (SSE) for live log streaming

## Layers

**API Layer (Ingestion):**
- Purpose: Accept and process log entries from external sources via OTLP/HTTP and simple-ingest protocols
- Location: `src/routes/v1/logs/+server.ts`, `src/routes/v1/ingest/+server.ts`
- Contains: Log normalization, OTLP mapping, incident fingerprinting, API key validation
- Depends on: Database layer, event bus, incident utilities
- Used by: External log sources (SDKs, agents, services)

**API Layer (Web):**
- Purpose: Serve REST endpoints for UI operations (project/log CRUD, querying, streaming)
- Location: `src/routes/api/`
- Contains: Project management, log retrieval, incident queries, real-time streaming endpoints
- Depends on: Database layer, authentication guards, event bus
- Used by: SvelteKit pages and browser-side code

**Application Layer:**
- Purpose: Core business logic, authorization, data transformation
- Location: `src/lib/server/`
- Contains:
  - `auth.ts`: Authentication initialization with better-auth
  - `db/schema.ts`: Drizzle table definitions and types
  - `db/index.ts`: Database client initialization
  - `events.ts`: In-memory event bus for project-scoped streaming
  - `utils/`: Guards (auth, project ownership), search, incidents, OTLP parsing, API key validation
  - `config/`: Environment validation, performance tuning parameters
  - `jobs/`: Background tasks (log cleanup scheduler)
- Depends on: External libraries (Drizzle ORM, better-auth, postgres.js)
- Used by: API handlers, hooks, scheduled jobs

**Presentation Layer:**
- Purpose: User interface rendering and client-side state management
- Location: `src/routes/`, `src/lib/components/`
- Contains: Svelte pages, layout components, UI component library (shadcn-svelte)
- Depends on: Application layer APIs, Svelte stores
- Used by: Browser clients

**Shared Layer:**
- Purpose: Type definitions and constants shared between client and server
- Location: `src/lib/shared/types.ts`
- Contains: Log levels, incident statuses, validation schemas
- Depends on: zod for schema validation
- Used by: Both client and server code

## Data Flow

**Log Ingestion Flow:**

1. External source sends POST to `/v1/logs` with OTLP JSON payload
2. `validateApiKey()` checks Authorization header against project table (cached 5 min)
3. `normalizeOtlpLogsRequest()` maps OTLP fields to log columns
4. `prepareLogsForIncidents()` extracts incident metadata (fingerprint, service, source file)
5. `upsertIncidentsForPreparedLogs()` creates/updates incident records based on fingerprint
6. Logs inserted into `log` table with full-text search index populated
7. `logEventBus.emitLog()` broadcasts to all SSE subscribers for that project
8. Response returns OTLP PartialSuccess format (some logs may be rejected)

**Real-time Streaming Flow:**

1. Client POST to `/api/projects/[id]/logs/stream` (requires session auth + project ownership)
2. `requireProjectOwnership()` validates user owns the project
3. Server creates ReadableStream with TextEncoder for SSE formatting
4. `logEventBus.onLog(projectId, listener)` subscribes to project's log events
5. Incoming logs batched in-memory with configurable delay (default 1.5s)
6. When batch reaches MAX_BATCH_SIZE (50) or window expires, flush as SSE event
7. Heartbeat events sent every 30s to prevent client timeout
8. Cleanup function unsubscribes when client disconnects

**Log Query Flow:**

1. Client GET to `/api/projects/[id]/logs` with query parameters (limit, cursor, level, search, from, to)
2. `requireProjectOwnership()` enforces authorization
3. Full-text search query built via `buildSearchQuery()` (PostgreSQL tsquery format)
4. Drizzle query constructs WHERE clause with all filters
5. Cursor-based pagination via `decodeCursor()`/`encodeCursor()` for stable ordering
6. Results returned with next cursor for client to fetch subsequent pages

**Incident Timeline Flow:**

1. Client GET to `/api/projects/[id]/incidents/[incidentId]/timeline/+server.ts`
2. Query incident records grouped by fingerprint, aggregated by time buckets
3. Return timeline with incident status transitions and log counts per period
4. Client renders timeline visualization using time-series aggregation

**State Management:**

- Server state: PostgreSQL database + in-memory event bus
- Session state: Managed by better-auth (stored in `session` table, passed via HTTP cookies)
- Client state: Svelte reactive stores (`createLogStreamStore()` in `src/lib/stores/logs.svelte.ts`)
- Real-time state: Synced via SSE from event bus

## Key Abstractions

**Project:**
- Purpose: Represents a customer workspace with scoped resources (logs, incidents, API key)
- Examples: `src/lib/server/db/schema.ts` (project table), `src/routes/api/projects/` (CRUD endpoints)
- Pattern: Table row with owner_id foreign key for authorization

**Log:**
- Purpose: Individual log entry with OTLP-compatible metadata and full-text search support
- Examples: `src/lib/server/db/schema.ts` (log table), `src/routes/v1/logs/+server.ts` (ingestion)
- Pattern: Column-per-field design with generated tsvector for search index

**Incident:**
- Purpose: Groups related logs by error fingerprint to track recurring problems
- Examples: `src/lib/server/db/schema.ts` (incident table), `src/lib/server/utils/incidents.ts` (grouping logic)
- Pattern: Fingerprint-based aggregation with status tracking (open/resolved/reopened)

**API Key:**
- Purpose: Project-specific authentication token for external log ingestion
- Examples: `src/lib/server/utils/api-key.ts` (validation and generation)
- Pattern: Format `lw_[32 alphanumeric]` with in-memory cache (5-minute TTL)

**Event Bus:**
- Purpose: In-memory publish-subscribe for real-time log streaming
- Examples: `src/lib/server/events.ts` (LogEventBus class)
- Pattern: Project-scoped listeners; no persistence; replaced by database polling if needed

**Log Stream Store:**
- Purpose: Client-side reactive store for buffering real-time logs with memory limits
- Examples: `src/lib/stores/logs.svelte.ts` (createLogStreamStore function)
- Pattern: Newest-first ordering with configurable max capacity (default 1000)

## Entry Points

**Server Entry:**
- Location: `src/hooks.server.ts`
- Triggers: Every HTTP request during build and runtime
- Responsibilities:
  - Initialize auth system on startup (via `initAuth()`)
  - Start log cleanup scheduler on startup
  - Attach session and user to `event.locals` for all routes
  - Route `/api/auth/*` requests to better-auth handler
  - Catch server errors and return sanitized responses

**API Ingestion Entry:**
- Location: `src/routes/v1/logs/+server.ts` (POST handler)
- Triggers: External log sources sending OTLP JSON
- Responsibilities:
  - Validate API key from Authorization header
  - Parse and normalize OTLP request
  - Create/update incidents based on fingerprints
  - Insert logs into database
  - Emit to event bus for real-time subscribers
  - Return OTLP-compliant response with PartialSuccess

**Web UI Entry:**
- Location: `src/routes/(app)/+layout.server.ts` (layout load function)
- Triggers: All app routes under `(app)/`
- Responsibilities:
  - Enforce session authentication (redirect to /login if missing)
  - Pass user and session data to all child routes

**Login Entry:**
- Location: `src/routes/login/+page.svelte`, `src/routes/login/+page.server.ts`
- Triggers: Navigation to /login or redirect from protected routes
- Responsibilities:
  - Render login form
  - Handle signup/signin via better-auth
  - Redirect authenticated users to home

## Error Handling

**Strategy:** Centralized error handler in `src/lib/server/error-handler.ts` with unique error IDs for tracking.

**Patterns:**

- **API Key Validation:** Throws `ApiKeyError` (401/403) if format invalid or key not found
- **Authorization:** Returns 404 JSON from `requireProjectOwnership()` to hide project existence
- **Insufficient Auth:** Throws SvelteKit redirect to `/login` from `requireAuth()`
- **Server Errors:** Global `handleError` hook logs with error ID and returns sanitized message to client
- **Request Validation:** OTLP validation returns `OtlpValidationError` with rejectedLogRecords count
- **Database Errors:** Caught in API handlers and returned as 500 errors (not exposed to client)

## Cross-Cutting Concerns

**Logging:**
- Console.error for errors with error ID and context (url, method, route, status)
- No structured logging library; errors logged with full stack when available

**Validation:**
- `validateApiKeyFormat()` for regex-based API key format checking
- `validateEnv()` in `src/lib/server/config/env.ts` for required environment variables at startup
- `OtlpValidationError` for OTLP request format validation
- Zod schemas in `src/lib/shared/types.ts` for runtime type checking

**Authentication:**
- Session auth via better-auth (email/password) for web UI
- API key auth (Bearer token) for log ingestion
- Session validation enforced by `requireAuth()` guard
- Lazy initialization of auth system to avoid test environment issues

**Authorization:**
- Project ownership verified via `requireProjectOwnership()` (checks ownerId == userId)
- All project-scoped operations require ownership check
- API key ownership implicit (API key tied to project)

**Caching:**
- API key cache: In-memory Map with 5-minute TTL
- No database query result caching; relies on PostgreSQL query cache
- Cache invalidated on API key regeneration

**Configuration:**
- Environment variables parsed in `src/lib/server/config/env.ts` at startup
- Performance parameters configurable via env vars with clamped bounds
- Startup validation ensures critical vars (DATABASE_URL, BETTER_AUTH_SECRET) are set
- Sensible defaults for performance tuning (SSE batch window 1.5s, heartbeat 30s)

---

*Architecture analysis: 2026-02-26*
