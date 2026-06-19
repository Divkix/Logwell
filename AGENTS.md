# Logwell — Agent Guide

## What is Logwell

Logwell is a **self-hosted, single-tenant logging + incident-intelligence platform**. Services ship logs to it (OTLP/HTTP JSON or a simple JSON API) using a per-project API key; Logwell stores them in PostgreSQL with full-text search, automatically groups error/fatal logs into **fingerprinted incidents**, and streams new logs and incidents to a live web dashboard over Server-Sent Events. Stack: **SvelteKit (Svelte 5 runes) on the Bun runtime**, **PostgreSQL 18** via **Drizzle ORM**, **better-auth** (username/password, single admin user), **shadcn-svelte + Tailwind CSS v4** UI, packaged as a **multi-arch Docker image** via `svelte-adapter-bun`. Three first-party SDKs (TypeScript, Python, Go) live in `sdks/`. Tooling is **Vite+** (the `vp` CLI: oxlint/oxfmt/vitest/build) with `bun` as the package manager.

## How to maintain this document

**AGENTS.md is the single source of truth.** Whenever you discover something new, non-obvious, or surprising about this codebase — a design decision, a gotcha, a workflow, a convention, an env var, a CI quirk — **add it to the relevant section in the same change that surfaced it**. Then **consolidate**: merge the note into the existing structure, dedupe against what's already there, and keep each section tight. Do not append stray notes at the bottom or create parallel docs; fold knowledge into the right home so this file stays accurate and scannable as the code evolves. (Several stale companion docs already exist — see Gotchas — which is exactly the failure mode to avoid.)

---

## Critical Commands

| Task                      | Command                                             | Notes                                          |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| Dev server                | `bun run dev`                                       | port **5173**                                  |
| Production preview        | `bun run preview`                                   | port **3000**                                  |
| Build                     | `bun run build`                                     | `vp build` → `svelte-adapter-bun` → `build/`   |
| Start Postgres            | `bun run db:start`                                  | `docker compose up -d` (postgres:18-alpine)    |
| Stop Postgres + wipe data | `bun run db:stop`                                   | `docker compose down -v`                       |
| Apply migrations (prod)   | `bun run db:migrate`                                | `drizzle-kit migrate` — committed SQL          |
| Push schema (dev/CI only) | `bun run db:push`                                   | `drizzle-kit push` — diff schema → DB          |
| Generate migration        | `bun run db:generate`                               | `drizzle-kit generate` after schema edit       |
| Drizzle Studio            | `bun run db:studio`                                 |                                                |
| Seed admin user           | `bun run db:seed`                                   | needs `ADMIN_PASSWORD` (≥8 chars)              |
| Backfill incidents        | `bun run incidents:backfill`                        | retro-fingerprint existing logs                |
| Lint + format + types     | `vp check` (`bun run lint`)                         | `--fix` to auto-fix                            |
| svelte-check (Svelte+TS)  | `bun run check`                                     | runs `svelte-kit sync` first                   |
| Dead-code check           | `bun run knip`                                      |                                                |
| All tests (watch)         | `bun run test`                                      | `vp test` — unit + component + integration     |
| Unit / Component / Integ. | `bun run test:unit` / `:component` / `:integration` | per-project Vitest                             |
| Coverage                  | `bun run test:coverage`                             | v8, thresholds enforced                        |
| E2E                       | `bun run test:e2e`                                  | Playwright; needs real Postgres + seeded admin |
| SDK tests (TS)            | `bun run sdk:test`                                  | delegates to `sdks/typescript`                 |

**Pre-commit checklist:** `vp check && bun run knip` (and `bun run check` for Svelte/TS types). Run the nearest test tier for code you touched.

---

## Architecture & Tech Stack

| Layer       | Tech                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| Framework   | SvelteKit 2 (Svelte 5 runes), **Bun runtime**                                 |
| Database    | PostgreSQL 18                                                                 |
| ORM         | Drizzle (`drizzle-orm` + `drizzle-kit`)                                       |
| DB drivers  | `postgres` (postgres-js) in prod, `@electric-sql/pglite` in integration tests |
| Auth        | better-auth (`username()` plugin, email/password, 7-day sessions)             |
| UI          | shadcn-svelte + bits-ui + Tailwind CSS v4 + layerchart                        |
| Real-time   | Server-Sent Events (in-memory event bus)                                      |
| Validation  | Zod 4 (shared client/server/SDK schemas)                                      |
| Adapter     | `svelte-adapter-bun` (NOT the Node adapter)                                   |
| Toolchain   | Vite+ (`vp`): oxlint, oxfmt, Vitest, tsdown                                   |
| Pkg manager | `bun` (pinned `bun@1.3.14`; engines `>=1.2.0`)                                |

### Directory Structure

```
src/
  hooks.server.ts          # request lifecycle: auth, DB injection, rate-limit, CSRF gate point, error handler
  lib/
    components/ui/          # shadcn-svelte primitives (not our code to test)
    server/
      auth.ts               # createAuth() — lazy-initialized better-auth, test-injectable DB
      db/
        schema.ts           # Drizzle schema — SINGLE SOURCE OF TRUTH for tables/types
        db.ts               # DatabaseClient type + getDbClient(locals) injection seam
        index.ts            # production postgres-js singleton
        test-db.ts          # PGlite schema-reflection engine for integration tests
      config/               # env.ts (validated env), performance.ts (tunables), index.ts
      jobs/                 # log-cleanup.ts, cleanup-scheduler.ts (retention sweeps)
      utils/                # api-key, csrf, rate-limit, cursor, search, incidents, otlp, simple-ingest, ...
      events.ts             # logEventBus singleton (SSE pub/sub)
      error-handler.ts      # createErrorHandler() — sanitized errors + error IDs
    shared/schemas/         # Zod schemas shared by client/server/SDKs (project, log, incident)
    stores/                 # logs.svelte.ts (runes store)
    hooks/                  # use-log-stream / use-incident-stream (runes; SSE consumers)
  routes/
    (app)/                  # authenticated dashboard pages (session-guarded)
    api/                    # session+CSRF JSON API (dashboard backend)
    v1/                     # API-key ingest endpoints (logs, ingest)
    login/                  # login page + form action
tests/
  integration/             # *.integration.test.ts (PGlite, route handlers)
  e2e/                      # Playwright specs + helpers/ (EXCLUDED from Vitest)
  fixtures/db.ts            # seedProject / seedLog / seedProjectWithApiKey factories
  setup.ts                 # global Vitest setup (jest-dom, cleanup, fallback env)
scripts/                   # seed-admin.ts, backfill-incidents.ts (+ *.test.ts run as integration)
sdks/                      # typescript/ python/ go/ — independent packages
drizzle/                   # committed migration SQL + journal
Dockerfile, entrypoint.sh, compose.yaml
```

---

## Request Lifecycle / Server Core (`src/hooks.server.ts`)

Every request flows through the combined `handle` hook:

1. **Build guard** — during `vite build` (`building`), short-circuit `resolve(event)`.
2. **One-time init** (`ensureInitialized`) — `initAuth()` (lazy better-auth) then `startCleanupScheduler()`. Also registers `SIGTERM`/`SIGINT` handlers that stop the scheduler and exit after a ~5s grace window.
3. **DB injection seam** — `event.locals.db = db` on **every** route. This is the prod/test seam: integration tests overwrite `locals.db` with a PGlite client, so handlers never import a DB directly — they call `getDbClient(event.locals)` (`src/lib/server/db/db.ts`), which returns `locals.db` if present else the prod singleton.
4. **Login brute-force guard** — `POST /api/auth/sign-in*` is rate-limited per client IP via `checkRateLimit('login:'+ip, LOGIN_RPM)`; over the limit returns **429** with `Retry-After: 60`.
5. **Auth fast-path skip** — `/v1/*`, `/api/health`, `/static/*` skip session lookup entirely (ingest is API-key/bearer; health is public).
6. **Session resolution** — `auth.api.getSession()` populates `event.locals.session` / `event.locals.user`, then defers to better-auth's `svelteKitHandler` (which routes `/api/auth/*`).

**Auth** (`src/lib/server/auth.ts`): `createAuth(db)` builds a better-auth instance using the Drizzle adapter, `username()` plugin, email/password with `autoSignIn`, 7-day sessions (refreshed every 24h), `trustedOrigins` from `ORIGIN`. The default `auth` export is a lazy Proxy that **throws** `"Auth not initialized…"` if accessed before `initAuth()` — `initAuth()` (idempotent, lazily imports `./db`) must run first; the hooks guarantee this. The laziness exists so tests don't import `$env/dynamic/private`; taking `db` as a parameter is what lets tests run auth against PGlite.

> **Security footgun — `src/lib/server/session.ts` is TEST-ONLY.** Its `getSession()` parses the `better-auth.session_token` cookie and does a **raw DB lookup with NO HMAC signature verification** (manual `expiresAt < now` check). It is for integration-test setup only — production/route code MUST use `auth.api.getSession()`. Using `session.ts` in a route is a forgeable-session hole.

**SSE event bus** (`src/lib/server/events.ts`): `logEventBus` is an in-process singleton with **project-scoped** listener sets for logs and incidents. Ingest handlers call `emitLog(log)` / `emitIncident(incident)`; SSE routes `onLog/onIncident(projectId, cb)` and get an unsubscribe fn. Emitted log shape is `StreamLog = Omit<Log,'search'>` (the tsvector is never serialized). **This is in-memory and single-process** — it does not fan out across multiple app instances; horizontal scaling of live streaming would need an external bus.

**Error handling** (`error-handler.ts` + `handleError`): logs full context server-side, returns a **sanitized** message + a generated **error ID** to the client.

---

## HTTP Surface

Two distinct API families with different auth + protections — **do not conflate them**:

| Family    | Auth                                                     | Protections                                          | Purpose                            |
| --------- | -------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `/api/**` | **session cookie** (better-auth) + **project ownership** | **CSRF** (Origin/Referer) on state-changing requests | dashboard backend                  |
| `/v1/**`  | **API key** `Authorization: Bearer lw_…`                 | **per-project rate limit** (`INGEST_RPM`)            | log ingestion by external services |

`/v1` deliberately does **not** run the CSRF check (`checkCsrfOrigin`) — SDKs/curl legitimately omit Origin/Referer. Conversely every `/api` state-changing handler is cookie-authenticated and runs `checkCsrfOrigin` (in `src/lib/server/utils/csrf.ts`): GET/HEAD/OPTIONS pass; an `Origin` mismatch or bad `Referer` → 403; **and a request with neither Origin nor Referer → 403** (tightened to close the ambient-cookie CSRF hole).

**Auth/ownership guards** (`auth-guard.ts`, `project-guard.ts`) branch by surface and intentionally **return 404 (not 403) for not-owned/missing projects to hide existence**:

- `requireAuth` — `/api/*` routes throw a SvelteKit **401** `HttpError` (`{message:'Unauthorized'}`); page routes throw a **303** redirect to `/login`. Partial sessions (user without session, or vice-versa) are rejected.
- `requireProjectOwnership(event, id)` returns a JSON **404** `Response` (caller must check `instanceof Response`); the page-loader twin `requireProjectOwnershipPage` **throws** SvelteKit `error(404)` (renders the error PAGE). Both delegate to a shared `findOwnedProject` (ownership = `ownerId === user.id`) so the SQL can't drift — **they are not interchangeable; use the right one for API vs page.**

**There is no programmatic read API.** API keys (`lw_*`) grant **write/ingest only**; logs and incidents are readable solely through the session-authenticated `/api` surface (the UI). A read/query API is the unbuilt spike `plans/018`.

### Route map

| Method           | Route                                                | Auth         | Notes                                                |
| ---------------- | ---------------------------------------------------- | ------------ | ---------------------------------------------------- |
| POST             | `/v1/logs`                                           | API key      | OTLP/HTTP JSON log export                            |
| POST             | `/v1/ingest`                                         | API key      | Simple JSON (single object or array)                 |
| GET              | `/api/health`                                        | none         | liveness                                             |
| GET/POST         | `/api/projects`                                      | session      | list / create project                                |
| GET/PATCH/DELETE | `/api/projects/[id]`                                 | session+CSRF | project CRUD                                         |
| POST             | `/api/projects/[id]/regenerate`                      | session+CSRF | rotate API key (returns new plaintext once)          |
| GET              | `/api/projects/[id]/logs`                            | session      | paginated/filtered/searchable log query              |
| POST             | `/api/projects/[id]/logs/stream`                     | session+CSRF | **SSE** live log stream                              |
| GET              | `/api/projects/[id]/logs/export`                     | session      | CSV/JSON export (≤ `EXPORT_CONFIG.MAX_LOGS` = 10000) |
| GET              | `/api/projects/[id]/stats`                           | session      | aggregate stats                                      |
| GET              | `/api/projects/[id]/stats/timeseries`                | session      | bucketed counts                                      |
| GET              | `/api/projects/[id]/incidents`                       | session      | incident list                                        |
| POST             | `/api/projects/[id]/incidents/stream`                | session+CSRF | **SSE** live incident stream                         |
| GET/PATCH        | `/api/projects/[id]/incidents/[incidentId]`          | session      | incident detail / status                             |
| GET              | `/api/projects/[id]/incidents/[incidentId]/timeline` | session      | event timeline                                       |

### SSE streams

`/api/projects/[id]/logs/stream` (and the incident equivalent) are **POST** SSE endpoints (CSRF-checked). They subscribe to `logEventBus` and emit batched `event: logs` / `event: incidents` plus `event: heartbeat`. Batching: buffer up to `SSE_CONFIG.BATCH_WINDOW_MS` (1500ms) or `MAX_BATCH_SIZE` (50) then flush; heartbeat every `HEARTBEAT_INTERVAL_MS` (30s). Backpressure (slow consumer, `desiredSize < 0`) **drops the batch but keeps the connection open**; a `CountQueuingStrategy({ highWaterMark: 256 })` absorbs bursts. The `cancel()`/cleanup path unsubscribes + clears timers on disconnect.

### Pagination & query (`/api/projects/[id]/logs`)

- **Cursor-based** (preferred): keyset on `(timestamp DESC, id DESC)`, opaque cursor via `cursor.ts` (`encodeCursor`/`decodeCursor`); malformed → 400 `invalid_cursor`. `offset` still accepted for back-compat but deprecated.
- `limit` clamped 1–500 (default 100). Fetches `limit+1` to compute `has_more` and `nextCursor`.
- Filters: `level` (comma-separated, e.g. `error,fatal`), `from`/`to` (ISO 8601), `search` (full-text via `buildSearchQuery` → `to_tsquery('english', …)` against the `search` tsvector / GIN index).
- `total` uses `cappedLogCount` (bounded count, `total_is_capped` flag) on the first page only; **skipped entirely when a cursor is present** to save a round-trip.

---

## Log Ingestion + Incident Intelligence Data Path

Both ingest routes (`/v1/logs` OTLP, `/v1/ingest` simple) follow the same pipeline:

1. **Content-Type guard** (`requireJsonContentType`) → **API-key validation** (`validateApiKey` resolves the project from the SHA-256 hash) → **re-verify the project row exists** (one extra read; guards against stale per-process caches causing FK violations) → **per-project rate limit** (`ingest:{projectId}`, `INGEST_RPM` = 600/min).
2. **Parse/normalize**: OTLP via `normalizeOtlpLogsRequest` + `mapOtlpAttributesToLogColumns`; simple via `parseSimpleIngestRequest`. Batch capped at `API_CONFIG.BATCH_INSERT_LIMIT` = **100** records → 400 `batch_too_large`. Invalid records are counted as `rejected` with per-record `errors` (the rest still ingest).
3. **Fingerprint + incident upsert** (in a single DB transaction): `prepareLogsForIncidents` → `upsertIncidentsForPreparedLogs` → `assignIncidentIds`. Fingerprinting (`incident-fingerprint.ts`): normalize the message (lowercase/trim, then replace UUIDs→`{uuid}`, hex IDs→`{hex}`, IPv4→`{ip}`, numbers→`{num}`, collapse whitespace; order is fixed and load-bearing), build seed `service|sourceFile|lineNumber|normalizedMessage`, SHA-256 → 32-char hex. Incidents are uniquely keyed `(projectId, fingerprint)`; an upsert bumps `lastSeen`/`totalEvents`/`highestLevel`. Auto-resolve after `INCIDENT_AUTO_RESOLVE_MINUTES` (30) of silence.
4. **Insert logs** with the assigned `incidentId`/`fingerprint`. The insert `.returning(...)` **explicitly lists every column except `search`** (the generated tsvector) — there's a deliberate `as any` cast because the `DatabaseClient` union breaks the `.returning()` overload; the explicit column map is the source of truth.
5. **Broadcast**: for each inserted log `logEventBus.emitLog(log)`, for each touched incident `emitIncident(incident)` → SSE consumers → live UI.

**API keys** (`api-key.ts`): format `lw_` + 32 url-safe chars (`/^lw_[A-Za-z0-9_-]{32}$/`, `lw_${nanoid(32)}`); stored as **SHA-256 hex** only. `validateApiKey` keeps an in-process cache (positive 5 min, negative 30 s) — which is exactly why the ingest pipeline does the extra "re-verify project row exists" read: a deleted project whose key is still cached must yield **401 `unauthorized`, not a 500 FK violation**.

**Simple-ingest contract** (`/v1/ingest`): per-log validation failures do **not** fail the request — it returns **200** with `{ accepted }`, adding `{ rejected, errors[] }` (array of strings) when any record is rejected. Only batch-level problems return 4xx. Error codes (JSON `{error,message}`): `415 unsupported_media_type`, `400 invalid_json`, `400 validation_error` (e.g. empty array), `400 batch_too_large` (> `BATCH_INSERT_LIMIT` 100), `401 unauthorized`, `429 rate_limited` (+ `Retry-After: 60`, **zero** logs written). Metadata keys are mapped to dedicated columns: `request.id`→`requestId`, `enduser.id`→`userId`, `client.address`→`ipAddress`; a top-level `service` becomes `serviceName` + `resourceAttributes."service.name"`; an empty `{}` metadata stores as `NULL`.

**Incident grouping** is **error/fatal only** (`INCIDENT_GROUPED_LEVELS`); other levels get `null` fingerprint/incidentId (but still get `serviceName` extracted). `highestLevel` collapses to the more severe of the two (`fatal` > `error`) via `LEVEL_RANK` (debug 10 … fatal 50). **Incident open/resolved status is purely time-derived, never stored**: `getIncidentStatus(lastSeen)` returns `open` when `now - lastSeen ≤ AUTO_RESOLVE_MINUTES`, else `resolved`, recomputed per row at serialization. ⚠ The client (`incidents/+page.svelte` `computeStatus`) **hardcodes `30 * 60 * 1000`**, so `INCIDENT_AUTO_RESOLVE_MINUTES` must stay **30** or server and UI status will disagree.

The `search` tsvector is a Postgres **STORED generated column**: `to_tsvector('english', COALESCE(message,'') || ' ' || COALESCE(body::text,'') || ' ' || COALESCE(metadata::text,'') || ' ' || COALESCE(resource_attributes::text,'') || ' ' || COALESCE(scope_attributes::text,''))`. It uses `||` + `COALESCE` and **not** `concat_ws` on purpose: a STORED generated column requires an **IMMUTABLE** expression, and `concat_ws` is only `STABLE` (Postgres rejects it). **Keep this expression in sync across three places**: `schema.ts` (`log.search` `generatedAlwaysAs`), the latest recreating migration (`drizzle/0010_*.sql`), and the `log_search_trigger` PL/pgSQL function in `test-db.ts` (PGlite can't do STORED generated columns, so it emulates via a `BEFORE INSERT/UPDATE` trigger).

---

## Database

- **Schema** (`src/lib/server/db/schema.ts`) — the single source of truth. Tables: `project`, `incident`, `log`, plus better-auth `user`/`session`/`account`/`verification`. `log_level` enum = `debug|info|warn|error|fatal`.
  - `project.apiKeyHash` is **SHA-256 only** — plaintext key is shown once at create/regenerate, never stored. `retentionDays`: `null` = system default, `0` = never delete, `>0` = days. **Project names are unique PER OWNER, not globally** — `uniqueIndex("uq_project_name_owner").on(name, ownerId)` (migration `0007` dropped the old global `project_name_unique`); this is an intentional fix so users can't enumerate/squat others' project names.
  - `log` carries full OTLP fields (trace/span, severity, resource/scope attributes) plus app fields, the generated `search` tsvector (GIN index `idx_log_search`), and FK to `incident` (`ON DELETE set null`).
  - `incident` is upserted on `uniqueIndex("uq_incident_project_fingerprint").on(projectId, fingerprint)` (the `ON CONFLICT` target); `highestLevel` reuses the `log_level` enum. Heavy indexing on `log` for project+timestamp, project+incident+timestamp, project+fingerprint, level, etc.
- **Config** (`drizzle.config.ts`): `postgresql` dialect, `strict`, requires `DATABASE_URL`.
- **Migrations** live in `drizzle/`. Edit `schema.ts` → `bun run db:generate` → commit the SQL. **Prod/CI apply with `db:migrate` (idempotent, ordered) — never `db:push` in prod** (`push` diffs live and is for dev/CI ephemeral DBs only). `entrypoint.sh` runs `drizzle-kit migrate` at container start; CI `test-migrations` job applies the committed SQL against a real Postgres to catch broken migrations.
- **Driver seam** (`db.ts`): single `DatabaseClient = PostgresJsDatabase | PgliteDatabase`. All handlers use `getDbClient(locals)`; `executeQuery`/`getQueryRows` normalize the two drivers' raw-result shapes (`T[]` vs `{rows: T[]}`).

---

## Frontend (Svelte 5 runes)

- Pages live under `src/routes/(app)/**` (authenticated; guarded in `+layout.server.ts`). Login is `src/routes/login/`.
- **Runes-based state**: `src/lib/stores/logs.svelte.ts` is a `.svelte.ts` store using `$state`. Live streaming consumers are hooks: `src/lib/hooks/use-log-stream.svelte.ts` and `use-incident-stream.svelte.ts` — they open the POST SSE endpoints, parse `logs`/`incidents`/`heartbeat` events, and push into the runes store, bounded by `LOG_STREAM_CONFIG.DEFAULT_MAX_LOGS` (1000, hard cap 10000).
  - ⚠ **Do not convert the stream hooks' internal `_isConnected`/`_isConnecting` to `$state`.** They are deliberately plain (non-reactive) vars: a component `$effect` both reads them (via `connect()`'s guards) and writes them, so making them `$state` creates a self-referential dependency → `effect_update_depth_exceeded` infinite loop that breaks page hydration. Connection state reaches the UI **only** through the `onConnectionChange` callback, not via reactive getters.
- UI = shadcn-svelte primitives in `src/lib/components/ui/` (treated as vendor — excluded from coverage and knip ownership). Tailwind CSS v4 via `@tailwindcss/vite`.

---

## Shared Zod Schemas (the contract)

`src/lib/shared/schemas/` holds Zod schemas that are the **single contract across client, server, and SDKs** — e.g. `project.ts` (`projectCreatePayloadSchema`, `projectUpdatePayloadSchema`: name 1–50 chars, `^[a-zA-Z0-9_-]+$`; `retentionDays` null/0/1–3650), `log.ts` (`parseLevelFilter`, log-level enum), `incident.ts`. The same level enum is mirrored in `schema.ts`'s `pgEnum` and the SDKs. Change a payload shape here and the corresponding SDK types and DB enum must move together.

---

## Config & Env Vars

`src/lib/server/config/env.ts` validates at module load (throws aggregated `EnvValidationError`). `performance.ts` parses numeric tunables (clamped to bounds). `rate-limit.ts` reads RPM env vars.

| Var                                                                        | Required    | Default           | Purpose                                                   |
| -------------------------------------------------------------------------- | ----------- | ----------------- | --------------------------------------------------------- |
| `DATABASE_URL`                                                             | **yes**     | —                 | Postgres conn string (must start with `postgres`)         |
| `BETTER_AUTH_SECRET`                                                       | yes (prod)  | dev-only fallback | ≥32 chars; required unless `NODE_ENV=development`         |
| `ADMIN_PASSWORD`                                                           | for seeding | —                 | ≥8 chars; `bun run db:seed` / entrypoint admin seed       |
| `ADMIN_USERNAME`                                                           | no          | `admin`           | seed admin username; email derived `<user>@logwell.local` |
| `ORIGIN`                                                                   | prod        | —                 | trusted origin for reverse proxies/tunnels (better-auth)  |
| `NODE_ENV`                                                                 | no          | `development`     | gates auth-secret strictness                              |
| `RATE_LIMIT_INGEST_RPM`                                                    | no          | 600               | per-project ingest cap                                    |
| `RATE_LIMIT_LOGIN_RPM`                                                     | no          | 10                | per-IP login cap (**CI/e2e set 10000**)                   |
| `SSE_BATCH_WINDOW_MS` / `SSE_MAX_BATCH_SIZE` / `SSE_HEARTBEAT_INTERVAL_MS` | no          | 1500 / 50 / 30000 | SSE batching/heartbeat                                    |
| `LOG_STREAM_MAX_LOGS`                                                      | no          | 1000              | in-memory logs per client (cap 10000)                     |
| `LOG_RETENTION_DAYS`                                                       | no          | 30                | system default retention (0 = disabled)                   |
| `LOG_CLEANUP_INTERVAL_MS`                                                  | no          | 3600000           | retention sweep interval                                  |
| `INCIDENT_AUTO_RESOLVE_MINUTES`                                            | no          | 30                | silence before an incident auto-resolves                  |

**Background jobs**: `cleanup-scheduler.ts` (started in `hooks.server.ts` init) runs `log-cleanup.ts` every `LOG_CLEANUP_INTERVAL_MS`, deleting logs past each project's effective retention (`retentionDays` override else `LOG_RETENTION_DAYS`; `0` disables). Scheduler is stopped on graceful shutdown. A separate stale-bucket sweep in `rate-limit.ts` evicts idle token buckets every 5 min.

---

## Testing Strategy (Testing Trophy — 4 tiers)

Tier is chosen by **filename suffix**, not directory. Vitest runs three projects (config: `vitest.config.ts`) via `vp`; Playwright is the fourth tier and is **excluded from Vitest** (`tests/e2e/**`).

| Tier        | Glob                                                                  | Env                                                     | DB                     | Command                    |
| ----------- | --------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------- | -------------------------- |
| Unit        | `src/**/*.unit.test.ts` (colocated)                                   | node                                                    | none/mocked            | `bun run test:unit`        |
| Component   | `src/**/*.component.test.ts`                                          | jsdom + `browser` condition + `@testing-library/svelte` | none                   | `bun run test:component`   |
| Integration | `tests/integration/**/*.integration.test.ts` + `scripts/**/*.test.ts` | node                                                    | **PGlite (in-memory)** | `bun run test:integration` |
| E2E         | `tests/e2e/**` (Playwright)                                           | real browser                                            | **real Postgres**      | `bun run test:e2e`         |

**Global setup** `tests/setup.ts`: jest-dom matchers, `@testing-library/svelte` `cleanup()` afterEach, fallback `DATABASE_URL` + `BETTER_AUTH_SECRET` (dummy — PGlite needs no real connection). Import test primitives from **`vite-plus/test`**, not `vitest`.

**Integration DB engine** (`src/lib/server/db/test-db.ts`): `setupTestDatabase()` → `createTestDatabase()` boots a fresh in-memory PGlite and **reflects `schema.ts` into hand-generated CREATE ENUM/TABLE/INDEX/TRIGGER SQL** in FK-dependency order (`user, project, incident, session, account, verification, log`) — it does **not** run `drizzle/*.sql`. PGlite workarounds, all deliberate: the `search` tsvector is reproduced via a `BEFORE INSERT/UPDATE` trigger (`log_search_trigger`) instead of a STORED generated column; unique indexes are emitted as table-level `UNIQUE` constraints (so `ON CONFLICT` upserts resolve); `VARCHAR` is hardcoded to `VARCHAR(255)`. `cleanup()` TRUNCATEs all tables CASCADE in reverse order. (Why PGlite over Docker: zero startup, fresh isolated DB per test. Why reflection over migrations: keeps `schema.ts` the single source and sidesteps PGlite's incompatibility with STORED/`IMMUTABLE` tsvector SQL. Tradeoff: not 100% Postgres parity — hence e2e runs real Postgres.)

**Route testing pattern**: import the route's `+server.ts` handlers directly, build a mock `RequestEvent` with `locals.db = <pglite>` (mirrors the prod injection seam), and for non-GET requests **set a same-origin `Origin` header** (the `createRequestEvent` helper auto-adds it) or `checkCsrfOrigin` returns 403. Seed via `tests/fixtures/db.ts` factories (`seedProject`, `seedLog`, `seedProjectWithApiKey` — returns the plaintext key since only the hash is stored, `getOrCreateDefaultUser`); don't hand-roll inserts. If you add a column/table/enum to `schema.ts`, `test-db.ts`'s type map and FK `tableOrder` may need updating or the table is silently skipped. **API-key tests must call `clearApiKeyCache()` in `beforeEach`** (the in-process key cache otherwise bleeds across tests).

**Two test conventions worth knowing before you refactor**: (1) Several integration tests **spy on `db.select` and throw if a handler pulls full rows into memory** — timeseries, incident-detail, and incident-timeline **must aggregate counts in SQL, not in JS**; don't "simplify" them into in-memory reductions. (2) `src/hooks.server.test.ts` does **not** invoke the real `handle` chain — it re-implements the session-population logic against PGlite, so the rate-limit guard, `/v1`/`/api/health` fast-paths, and `svelteKitHandler` are **not** covered there.

**E2E** (`playwright.config.ts`): `testDir tests/e2e`. **CI uses preview (built) mode on :4173** (avoids Vite dev HMR flakiness), **locally dev mode on :5173**; `workers:1`, `retries:2`, `github` reporter in CI. Every request gets a same-origin `Origin` header via `extraHTTPHeaders` so Playwright's request client passes CSRF. Projects: `chromium` + `firefox` (CI `ci.yml` runs chromium only; `release.yml` runs both). Helpers: `tests/e2e/helpers/otlp.ts` (POST OTLP to `/v1/logs` with bearer key), `helpers/log-selectors.ts` (viewport-aware locators). E2E admin is `admin`/`adminpass` matching `scripts/seed-admin.ts`.

**E2E login flake mitigation** (commits #153–#155): a hydration race where a click fires before SvelteKit hydrates the form handler caused a pre-hydration no-op. Fix: wrap fill+submit+assert in `await expect(async () => {…}).toPass({ timeout: 45000 })` to retry the whole interaction, **plus** CI sets `RATE_LIMIT_LOGIN_RPM: 10000` so repeated sign-ins (toPass retries × sharding) aren't 429'd. Preserve this pattern for any login-dependent spec. (One "redirect authenticated users away from login" test is `test.skip`'d pending a session-cookie persistence issue.)

---

## SDKs (`sdks/`)

Each SDK is an **independent package** with its own tooling and release workflow. All three share the same **Client → Queue → Transport** architecture (TypeScript is the reference; Python and Go mirror it file-for-file): a `Logwell` **client** (level methods, child loggers, source-location capture) hands entries to a **BatchQueue** (buffering + flush triggers) which a **Transport** ships to `/v1/ingest` (or OTLP) with retry. Files map 1:1: `client` / `queue` / `transport` / `config` / `types` / `errors` / `source(-location)`.

| SDK        | Dir                | Build                               | Test                                         | Lint                         | Types                                  | Publishes to                                  |
| ---------- | ------------------ | ----------------------------------- | -------------------------------------------- | ---------------------------- | -------------------------------------- | --------------------------------------------- |
| TypeScript | `sdks/typescript/` | `tsup` (CJS+ESM+`.d.ts`)            | Vitest (`test:unit`, `test:integration`)     | `vp check`                   | `tsc --noEmit`, `attw`, `size` (<10KB) | **npm** `logwell` + **JSR** `@divkix/logwell` |
| Python     | `sdks/python/`     | `hatchling` / `python -m build`     | `pytest` (`tests/unit`, `tests/integration`) | `ruff check` / `ruff format` | `mypy --strict`                        | **PyPI** `logwell`                            |
| Go         | `sdks/go/`         | `go build` (stdlib only, zero deps) | `go test -race ./...`                        | `golangci-lint`              | `go vet`                               | `go get github.com/Divkix/Logwell/sdks/go@…`  |

TS from repo root: `bun run sdk:test` / `sdk:build` / `sdk:lint`. Python: `cd sdks/python && uv venv && uv pip install -e ".[dev]"` then `pytest` / `ruff` / `mypy`. Go: `cd sdks/go && go test ./...`. Integration tests for SDKs need a running Logwell server.

**Shared SDK contract** (identical across all three — keep them aligned):

- **Wire format**: `POST {endpoint}/v1/ingest`, headers `Authorization: Bearer <apiKey>` + `Content-Type: application/json`, body is a **raw JSON array** of entries (no envelope), camelCase fields (`sourceFile`, `lineNumber`).
- **Config + validation**: defaults `batchSize 50`, `flushInterval 5000ms`, `maxQueueSize 1000`. Upper bounds are enforced (throw `INVALID_CONFIG`): `batchSize ≤ 100` (the server's `BATCH_INSERT_LIMIT`), `maxQueueSize ≤ 100000`, `flushInterval ∈ [100, 60000]ms`. The TS validator also masks the `apiKey` in error messages.
- **BatchQueue**: bounded; on overflow it drops the **oldest** entry and fires `onError` (`QUEUE_OVERFLOW`); on send failure it **re-queues the undelivered remainder** (preserving order) and retries. `shutdown()` does a final flush and **throws `NETWORK_ERROR`** if logs remain undelivered (the timer path only reports via `onError`).
- **Error taxonomy** (`LogwellError(message, code, statusCode?, retryable=false)`), 7 codes: `NETWORK_ERROR`(retry), `SERVER_ERROR`/5xx(retry), `RATE_LIMITED`/429(retry); `UNAUTHORIZED`/401, `VALIDATION_ERROR`/400, `QUEUE_OVERFLOW`, `INVALID_CONFIG` (all **non-retryable**). Only 5xx/429/network are retried with backoff.
- Per-language concurrency models differ: Python's `BatchQueue` runs a daemon asyncio loop on its own thread; Go's `Child()` loggers share the root's queue/transport and `Child.Shutdown()` does **not** flush (shut down the root). The `jsr.json` package (`@divkix/logwell`) exports raw `./src/index.ts`; the npm package (`logwell`) ships the tsup-built `./dist` — two names, two entry points.

---

## Tooling

- **Vite+ / `vp`** (`vite.config.ts`): unified toolchain (oxlint + oxfmt + Vitest + build). `vp check` = format+lint+typecheck (`--fix` to fix). 2-space indent, single quotes, trailing commas; Svelte files have relaxed rules (unused vars allowed). Inline disable: `// oxlint-disable-next-line <rule>`. **Pinned exact**: `vite`/`vitest` are aliased to `@voidzero-dev/vite-plus-core@0.1.24` / `-test@0.1.24` (note the `overrides` in `package.json`); `vite-plus@0.1.24`. Don't bump these casually.
- **knip** (`knip.json`): dead-code/dependency check. Entry points include SvelteKit route files + `db/index.ts`, `auth.ts`, `cleanup-scheduler.ts`. Has explicit ignores (`test-utils.ts`, certain exports in `db.ts`/`error-handler.ts`, deps like `tw-animate-css`/`layerchart`, the `jsr` binary). Run `bun run knip` pre-commit.
- **husky** (`.husky/`): installed via the `prepare` script (`vp config && husky && svelte-kit sync`). `.husky/pre-commit` runs `vp check && bun run knip`; a separate `.vite-hooks/pre-commit` (from `vp config`) runs the lighter `vp staged`. `husky` runs last in `prepare`, so `.husky/pre-commit` is the effective gate.
- **seed-admin** (`scripts/seed-admin.ts`): idempotent admin creation through better-auth using `ADMIN_USERNAME`/`ADMIN_PASSWORD`; email auto-derived `<user>@logwell.local` (`.local` because `localhost` fails email validation).
- **Pinned versions**: Bun `1.3.14` (pkg manager) / `1.2.15` (CI setup-bun) / `1.3.14-alpine` (Docker, with digest). Postgres `18-alpine` everywhere. Pinning is for reproducible builds.

---

## CI/CD (`.github/workflows/`)

All workflows checkout with `persist-credentials: false`, cache the Bun store, and use `bun install --frozen-lockfile`. CI env: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test_db`, placeholder `BETTER_AUTH_SECRET`, `CI=true`.

### `ci.yml` (push to `main` non-tags, PRs to `main`)

| Job                | Does                                                                                                                                                                                   | Local equivalent                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `lint`             | `bun run lint` + `prepare` + `bun run check`                                                                                                                                           | `vp check && bun run check`           |
| `test-unit`        | unit tests, **3 shards**                                                                                                                                                               | `bun run test:unit`                   |
| `test-component`   | component tests, **3 shards**                                                                                                                                                          | `bun run test:component`              |
| `test-coverage`    | v8 coverage (needs unit+component)                                                                                                                                                     | `bun run test:coverage`               |
| `test-integration` | PGlite integration, **3 shards**                                                                                                                                                       | `bun run test:integration`            |
| `test-e2e`         | Playwright **chromium**, 3 shards; real Postgres service, `drizzle-kit push --force`, seed admin (`ADMIN_PASSWORD=adminpass`), `RATE_LIMIT_LOGIN_RPM=10000`; uploads report on failure | `bun run test:e2e --project=chromium` |
| `test-migrations`  | applies committed `drizzle-kit migrate` against real Postgres                                                                                                                          | `bun run db:migrate`                  |
| `build`            | `bun --bun run build`, uploads `build/`                                                                                                                                                | `bun run build`                       |
| `docker-build`     | builds Docker image (no push), gha cache                                                                                                                                               | `docker build .`                      |
| `docker-publish`   | **main push only**: build `linux/amd64` (ubuntu) + `linux/arm64` (ubuntu-24.04-arm) by digest → GHCR                                                                                   | —                                     |
| `docker-merge`     | **main push only**: merge digests into multi-arch manifest, tags `dev`, `dev-<sha>`, `<sha>`                                                                                           | —                                     |
| `ci-success`       | gate: all required jobs must pass (docker jobs required only on main push)                                                                                                             | —                                     |

Coverage thresholds (`vitest.config.ts`): lines/statements/functions **75%**, branches **65%**; e2e-tested routes (`(app)/**`, `login/**`, `hooks.server.ts`) and shadcn primitives are excluded.

### `release.yml` (push tag `v*`, or manual)

Re-runs lint + unit + integration + **e2e across `chromium` AND `firefox` × 3 shards** (with `RATE_LIMIT_LOGIN_RPM=10000`), then builds + pushes the multi-arch Docker image and a GitHub Release. `cancel-in-progress: false` (partial releases must not be interrupted).

### SDK workflows (path-filtered to `sdks/<lang>/**`, push/PR to `main`)

- `sdk-typescript.yml` — lint (`vp check`; **stubs `.svelte-kit/tsconfig.json`** so the root tsconfig resolves in this SDK-only job), unit + integration tests, build + `attw` + `size`. `publish` job (main push, `id-token: write`): checks npm for `package.json`'s version → `npm publish` (OIDC) if new; checks JSR for `jsr.json`'s version → `npx jsr publish` (OIDC) if new. Both checks are independent and idempotent.
- `sdk-python.yml` — ruff lint+format, mypy `--strict`, pytest matrix (Py 3.10–3.13), coverage (`--cov-fail-under=90`), build + `twine check` + wheel install smoke. `publish` (main push, PyPI Trusted Publisher / OIDC): checks PyPI for `pyproject.toml` version → publishes if new.
- `sdk-go.yml` — golangci-lint (v2.10.1), `go test -race` matrix (Go 1.25/1.26), coverage. **No publish job** — Go modules resolve from git tags.

### Other

- `opencode.yml` — on `/oc` or `/opencode` issue/PR comments by OWNER/MEMBER/COLLABORATOR, runs the OpenCode agent.
- `dependabot.yml` — weekly Bun/npm updates (grouped: minor-and-patch together, svelte-ecosystem and testing grouped, majors separate), commit prefix `deps`.

Images: `ghcr.io/divkix/logwell` (`:dev`, `:dev-<sha>`, `:<sha>` from main; release tags from `release.yml`).

---

## Build & Deploy

- **Build**: `vp build` → `svelte-adapter-bun` emits a Bun server in `build/` (entry `build/index.js`). The app listens on **port 3000** in production (preview also 3000); dev is 5173.
- **Dockerfile** (multi-stage): `oven/bun:1.3.14-alpine` (pinned + digest) base → `deps` (`--production --ignore-scripts`) → `deps-dev` (full deps + `bun run prepare`) → `build` (copies config/static/`drizzle`/`scripts`/`entrypoint.sh`/`src` least-to-most-volatile for cache hits, `NODE_ENV=production`, builds) → runtime. Browser binary downloads are skipped (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` etc.). `curl` installed for healthcheck.
- **`entrypoint.sh`**: runs `drizzle-kit migrate` (aborts startup on failure) → seeds admin **only if `ADMIN_PASSWORD` is set** (and fails fast if the seed errors when it _is_ set) → `exec bun run ./build/index.js`.
- **`compose.yaml`**: local Postgres 18-alpine (`root`/`mysecretpassword`/`local` on 5432, named volume `pgdata`, `pg_isready` healthcheck).
- **PaaS targets**: any platform that runs the OCI image with `DATABASE_URL` + `BETTER_AUTH_SECRET` (+ `ORIGIN` behind a proxy/tunnel). Migrations run automatically on boot.

---

## Release Process

The **main app** and each **SDK** are versioned and released **independently** — each has its own version line (the app is not in lockstep with the SDKs). Commits and tags are GPG-signed (`commit.gpgsign` / `tag.gpgsign` are enabled), so signing must be available locally.

Two distinct trigger models, do not mix them up:

- **App** → **tag-triggered**: merging to `main` does NOT release; pushing a `v*` tag does.
- **SDKs (TS/Python)** → **merge-triggered**: pushing a version bump under `sdks/<lang>/**` to `main` runs the SDK workflow, which publishes whatever version is new. The `sdks/...@vX.Y.Z` tags are only git release **markers** — they do NOT trigger publishing. Publish jobs are idempotent: they check the registry and skip if the version already exists, so re-runs are safe.

### Main app — Docker image + GitHub Release (`release.yml`)

1. Bump `version` in the root `package.json` and merge to `main`. (The root `bun.lock` does not record the app version, so `--frozen-lockfile` is unaffected — no lockfile change needed.)
2. Tag the merge commit and push the tag:
   ```bash
   git tag -a v1.1.0 -m "Release v1.1.0"
   git push origin v1.1.0
   ```
   The `v*` tag triggers `release.yml` → multi-platform Docker images (`linux/amd64`, `linux/arm64`) to GHCR + a GitHub Release with auto-generated notes.

### TypeScript SDK — npm + JSR (`sdk-typescript.yml`, on push to `main` under `sdks/typescript/**`)

1. **Bump BOTH version fields** — they are separate and easy to desync:
   - `sdks/typescript/package.json` → `version` (read by the **npm** publish)
   - `sdks/typescript/jsr.json` → `version` (read by the **JSR** publish)

   If you bump only `package.json`, npm gets the new version while JSR silently stays on the old one (the JSR step finds the old version already published and skips).

2. Merge to `main`. The workflow publishes to npm (OIDC) if `package.json`'s version is new, and to JSR (`npx jsr publish`, OIDC) if `jsr.json`'s version is new.
3. (Optional) push the marker tag:
   ```bash
   git tag -a "sdks/typescript@v1.1.0" -m "Release sdks/typescript v1.1.0"
   git push origin "sdks/typescript@v1.1.0"
   ```

### Python SDK — PyPI (`sdk-python.yml`, on push to `main` under `sdks/python/**`)

1. Bump `version` in `sdks/python/pyproject.toml`, then sync the lockfile (it records the project version, and CI runs `uv lock --check`):
   ```bash
   cd sdks/python && uv lock
   ```
2. Merge to `main` → publishes to PyPI (OIDC) if the version is new.
3. (Optional) marker tag:
   ```bash
   git tag -a "sdks/python@v1.1.0" -m "Release sdks/python v1.1.0"
   git push origin "sdks/python@v1.1.0"
   ```

### Go SDK — tag-resolved by `go get` (no publish workflow)

Use the **slash** tag format so the Go toolchain can resolve the subdirectory module via `go get github.com/Divkix/Logwell/sdks/go@vX.Y.Z`:

```bash
git tag -a "sdks/go/v1.1.0" -m "Release sdks/go v1.1.0"
git push origin "sdks/go/v1.1.0"
```

---

## Decision Log & Roadmap (`plans/`)

The `plans/` directory is the durable **decision record** — self-contained handoff plans from the `improve` audit (planned at commit `8ec01b0`, 2026-06-17), each tied to a finding ID (F1–F18 / D1–D4). Most recent shipped work traces directly to a plan: **006** SSE backpressure → #142, **007** OTLP zero-timestamp → #144, **009** CSRF tightening, **012** batched incident upsert + narrowed `returning` → #145, **013** capped log count → #146, **014** tsvector single-parse → #147, **015** dedup time-range/level-filter helpers → #148, **016** unify `(app)` loader ownership + DB seam → #149. Plans **001–016 are done**; **017–020 are open SPIKEs** — design a vertical slice behind a flag, then STOP at a go/no-go gate; do **not** full-build:

| Spike | Direction                                                                           |
| ----- | ----------------------------------------------------------------------------------- |
| 017   | Incident alerting — outbound webhooks / Slack on new incidents                      |
| 018   | Programmatic read/query API + read-capable SDKs                                     |
| 019   | Incident lifecycle — acknowledge / mute / manual resolve (core-table schema change) |
| 020   | Backup-grade export (full-fidelity, uncapped, restorable)                           |

`plans/README.md` holds the status table, dependency graph (only hard blocker: **005 → 014**), shared-design notes (e.g. build incident `isNew`/reopen detection **once** in the upsert; compute status in one `computeIncidentStatus`), and a **"Considered and rejected"** ledger so settled questions aren't re-litigated — IDOR verified safe (`requireProjectOwnership` returns **404**, not 403, to hide existence), XSS/SQLi/mass-assignment audited clean, plus deferred minors (timeline/timeseries final-bucket off-by-one; the `/v1/ingest` `{error,message}` vs `/v1/logs` `{error}` 429 body-shape mismatch; login `X-Forwarded-For` trust is deployment-specific). Before roadmap work, read the relevant plan and **re-run its drift check** — the repo has moved past `8ec01b0`.

---

## Common Gotchas

1. **Ports**: dev = 5173, preview/production = 3000.
2. **Bun, not npm**: always `bun run …`; lockfile is `bun.lock`. Engines require Bun ≥1.2.0.
3. **Adapter**: `svelte-adapter-bun`, not the Node adapter. The prod entry is `build/index.js` run by Bun.
4. **`db:migrate` vs `db:push`**: prod/CI-real-Postgres apply committed migrations (`migrate`); `push` is for dev/ephemeral DBs only. After editing `schema.ts`, run `db:generate` and commit the SQL.
5. **tsvector triple-sync**: the `search` generated-column expression lives in `schema.ts`, the recreating migration (`drizzle/0010_*.sql`), and the PGlite `log_search_trigger` in `test-db.ts` — change all three together. It must stay `||`+`COALESCE` (IMMUTABLE), never `concat_ws`.
6. **CSRF on `/api`**: any non-GET request **without** an `Origin` or `Referer` is 403. Integration tests auto-inject `Origin` via `createRequestEvent`; hand-built `Request`s must add it. `/v1` ingest is exempt.
7. **API keys are hash-only**: plaintext is shown once at create/regenerate. Use `seedProjectWithApiKey` in tests to get the plaintext.
8. **SSE event bus is in-memory / single-process**: live streaming does not fan out across replicas; the in-memory token-bucket rate limiter is likewise per-process.
9. **e2e is Playwright-only**: Vitest excludes `tests/e2e/**`; it never picks them up. Local `test:e2e` runs chromium **and** firefox unless you pass `--project=chromium`.
10. **e2e prerequisites**: needs a real Postgres + a seeded admin (`ADMIN_PASSWORD`). Login specs must use the `expect().toPass()` retry pattern and benefit from `RATE_LIMIT_LOGIN_RPM=10000`.
11. **`test-db.ts` approximations**: schema comes from reflection (not `drizzle/*.sql`); `VARCHAR` is forced to 255; unique indexes become UNIQUE constraints. New schema column types may need the generator's type map / FK `tableOrder` updated or the table is silently skipped.
12. **Don't copy `tests/integration/api/health/health.integration.test.ts`'s inline CREATE TABLE** — it's a bespoke legacy setup (references an `api_key` column), not the shared `setupTestDatabase()` path.
13. **Stale companion docs**: `tests/README.md` (mentions a non-existent `.browser.test.ts` tier / `test:browser`, old `test-utils.ts` API, a `users` table) and `tests/fixtures/README.md` (mentions `createUserFactory`/age fields) are **out of date**. Trust this file, `vitest.config.ts`, `test-db.ts`, and `tests/fixtures/db.ts` instead — and fix the stale docs when you touch that area.
14. **Pinned Vite+/Bun/Postgres versions** are intentional for reproducibility; don't bump without reason. (CI's `setup-bun` pins **1.2.15** while the Docker image is **1.3.14** — CI and the prod image run different Bun versions by design.)
15. **`src/lib/server/session.ts` is TEST-ONLY** — `getSession()` skips HMAC signature verification. Never call it from a route; production uses `auth.api.getSession()`.
16. **Incident auto-resolve threshold is duplicated**: the server reads `INCIDENT_AUTO_RESOLVE_MINUTES`, but `incidents/+page.svelte` hardcodes `30 * 60 * 1000`. Keep the env at **30** or server/UI status disagree.
17. **Never make the SSE stream hooks' `_isConnected`/`_isConnecting` `$state`** — it triggers an `effect_update_depth_exceeded` hydration-breaking loop; surface connection state via the `onConnectionChange` callback instead.
18. **API keys are write-only**: there is no read/query API by key (logs read only via the session UI). **Project names are unique per-owner**, not globally.
19. **Per-log ingest errors are not request failures**: `/v1/ingest` returns **200** `{accepted, rejected, errors[]}` for bad records; only batch-level issues (`invalid_json`, `batch_too_large`, auth, rate-limit) return 4xx.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
