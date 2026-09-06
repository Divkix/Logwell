# Logwell — Agent Guide

## What is Logwell

Logwell is a **self-hosted, single-tenant logging + incident-intelligence platform**. Services ship logs to it (OTLP/HTTP JSON or a simple JSON API) using a per-project API key; Logwell stores them in PostgreSQL with full-text search, automatically groups error/fatal logs into **fingerprinted incidents**, and streams new logs and incidents to a live web dashboard over Server-Sent Events. Stack: see table below. Three first-party SDKs (TypeScript, Python, Go) live in `sdks/`.

## How to maintain this document

**AGENTS.md is the single source of truth.** When you surface something non-obvious — a design decision, gotcha, workflow, env var, CI quirk — fold it into the relevant section in the same change: merge, dedupe, keep it tight. Don't append stray notes or create parallel docs.

---

## Critical Commands

Ports: dev **5173**, preview **4173**, prod **3000**. Always `bun run …` (`bun.lock`; engines `bun >=1.2.0`).

| Task                      | Command                                             | Notes                                                   |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Lint + format + types     | `vp check` (`bun run lint`)                         | `--fix` to auto-fix                                     |
| Svelte/TS types           | `bun run check`                                     | `svelte-kit sync` + `svelte-check --tsgo`               |
| Dead code                 | `bun run knip`                                      |                                                         |
| Unit / Component / Integ. | `bun run test:unit` / `:component` / `:integration` | per-project Vitest                                      |
| Coverage                  | `bun run test:coverage`                             | v8, signal-only (no gate per #207)                      |
| E2E                       | `bun run test:e2e`                                  | Playwright; needs real Postgres + seeded admin          |
| DB start / stop+wipe      | `bun run db:start` / `db:stop`                      | `docker compose up -d` / `down -v` (postgres:18-alpine) |
| Migrations (prod)         | `bun run db:migrate`                                | committed SQL; `db:push` is dev/ephemeral only          |
| New migration             | `bun run db:generate`                               | after schema edit; commit the SQL (see Gotchas)         |
| Seed admin / backfill     | `bun run db:seed` / `incidents:backfill`            | seed needs `ADMIN_PASSWORD` (≥8 chars)                  |
| TS SDK                    | `bun run sdk:test` / `sdk:build` / `sdk:lint`       | delegates to `sdks/typescript`                          |

**Pre-commit:** `vp check && bun run knip` (+ `bun run check` for Svelte/TS). Run the nearest test tier for code you touched.

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
| Pkg manager | `bun` (pinned `bun@1.4.1`; engines `>=1.2.0`)                                 |

### Directory Structure

```
src/
  hooks.server.ts          # request lifecycle: auth, DB injection, rate-limit, CSRF, error handler
  lib/
    components/ui/          # shadcn-svelte primitives (vendor — don't test)
    server/
      auth.ts               # createAuth() — lazy better-auth, test-injectable DB
      db/
        schema.ts           # Drizzle schema — SINGLE SOURCE OF TRUTH for tables/types
        db.ts               # DatabaseClient type + getDbClient(locals) injection seam
        index.ts            # production postgres-js singleton
        test-db.ts          # PGlite schema-reflection engine for integration tests
      config/               # env.ts (validated env), performance.ts (tunables)
      jobs/                 # log-cleanup.ts, cleanup-scheduler.ts (retention sweeps)
      utils/                # ingest (pipeline), log-query, api-key, csrf, rate-limit, cursor, search, incidents, otlp, simple-ingest, ...
      events.ts             # logEventBus singleton (SSE pub/sub)
      error-handler.ts      # handleError() — sanitized errors + error IDs
    shared/schemas/         # Zod schemas shared by client/server/SDKs (project, log, incident)
    stores/                 # logs.svelte.ts (ClientLog type)
    hooks/                  # use-log-stream / use-incident-stream (POST SSE consumers)
  routes/
    (app)/                  # authenticated dashboard pages (session-guarded)
    api/                    # session+CSRF JSON API (dashboard backend)
    v1/                     # API-key ingest endpoints (logs, ingest)
    login/                  # login page + form action
tests/
  integration/             # *.integration.test.ts (PGlite, route handlers)
  e2e/                      # Playwright specs + helpers/ (EXCLUDED from Vitest)
  fixtures/db.ts            # seedProject / seedLog / seedProjectWithApiKey factories
  setup.ts                 # shared Vitest setup (jest-dom + fallback env)
  setup-component.ts       # component-only Testing Library cleanup
scripts/                   # seed-admin.ts, backfill-incidents.ts (+ *.test.ts run as integration)
sdks/                      # typescript/ python/ go/ — independent packages
drizzle/                   # committed migration SQL + journal
Dockerfile, entrypoint.sh, compose.yaml
```

---

## Request Lifecycle / Server Core (`src/hooks.server.ts`)

Every request flows through the combined `handle` hook:

1. **Build guard** — during `vite build` (`building`), short-circuit `resolve(event)`.
2. **One-time init** — `initAuth()` (lazy better-auth) then `startCleanupScheduler()`; `SIGTERM`/`SIGINT` handlers stop the scheduler and exit after a ~5s grace window.
3. **DB injection seam** — `event.locals.db = db` on **every** route. Handlers never import a DB directly; they call `getDbClient(event.locals)` (`db.ts`), which returns `locals.db` if present else the prod singleton. Integration tests overwrite `locals.db` with PGlite.
4. **Login brute-force guard** — `POST /api/auth/sign-in*` is rate-limited per client IP (`LOGIN_RPM`); over the limit → **429** + `Retry-After: 60`. CSRF on the login path is checked before rate-limiting.
5. **Sign-up kill-switch** — `POST /api/auth/sign-up*` → **403** (`sign_up_disabled`).
6. **Auth fast-path skip** — `/v1/*`, `/api/health`, `/static/*` skip session lookup entirely.
7. **Session resolution** — `auth.api.getSession()` populates `locals.session` / `locals.user`, then defers to better-auth's `svelteKitHandler` (routes `/api/auth/*`; non-GET there is CSRF-gated).

**Auth** (`auth.ts`): `createAuth(db)` with `username()` plugin, email/password `autoSignIn`, 7-day sessions (24h refresh), `trustedOrigins` from `ORIGIN` — see `auth.ts:12-28` for options. The default `auth` export is a lazy Proxy that **throws** if touched before `initAuth()` (idempotent, dynamically imports `./db` so tests don't pull in `$env/dynamic/private`). Taking `db` as a parameter is what lets tests run auth against PGlite.

> **Security footgun — `src/lib/server/session.ts` is TEST-ONLY.** Raw cookie lookup with NO signature verification. Production/route code MUST use `auth.api.getSession()`; using `session.ts` in a route is a forgeable-session hole.

**SSE event bus** (`events.ts`): in-process singleton with **project-scoped** listener sets. Ingest handlers `emitLog`/`emitIncident`; SSE routes `onLog`/`onIncident(projectId, cb)`. Emitted log shape is `StreamLog = Omit<Log,'search'>`. **Single-process** — no fan-out across replicas (same for the in-memory rate limiter); horizontal live-streaming needs an external bus.

**Error handling**: full context logged server-side; client gets a sanitized message + generated error ID.

---

## HTTP Surface

Two API families — **do not conflate them**:

| Family    | Auth                                       | Protections                                    | Purpose           |
| --------- | ------------------------------------------ | ---------------------------------------------- | ----------------- |
| `/api/**` | **session cookie** + **project ownership** | **CSRF** on everything except GET/HEAD/OPTIONS | dashboard backend |
| `/v1/**`  | **API key** `Authorization: Bearer lw_…`   | **per-project rate limit** (`INGEST_RPM`)      | log ingestion     |

`/v1` is exempt from CSRF (SDKs/curl omit Origin/Referer). `/api` state-changing requests run `checkCsrfOrigin`: Origin mismatch / bad Referer / **neither header present** → 403.

**Guards** (`auth-guard.ts`, `project-guard.ts`): `requireAuth` throws **401** for `/api/*`, **303** redirect to `/login` for pages; partial sessions rejected. Ownership failures return **404 (not 403)** to hide existence. `requireProjectOwnership` returns a JSON 404 `Response` (check `instanceof Response`); the page twin `requireProjectOwnershipPage` throws SvelteKit `error(404)`. Both share `findOwnedProject` (`ownerId === user.id`) — use the right twin for API vs page.

**No programmatic read API.** API keys grant **write/ingest only**; logs/incidents read only via the session `/api` surface. Read/query API is unbuilt spike `plans/018`.

### Route map

| Method           | Route                                                | Auth         | Notes                                                            |
| ---------------- | ---------------------------------------------------- | ------------ | ---------------------------------------------------------------- |
| POST             | `/v1/logs`                                           | API key      | OTLP/HTTP JSON log export                                        |
| POST             | `/v1/ingest`                                         | API key      | Simple JSON (single object or array)                             |
| GET              | `/api/health`                                        | none         | liveness                                                         |
| GET/POST         | `/api/projects`                                      | session      | list / create project                                            |
| GET/PATCH/DELETE | `/api/projects/[id]`                                 | session+CSRF | project CRUD                                                     |
| POST             | `/api/projects/[id]/regenerate`                      | session+CSRF | rotate API key (plaintext shown once)                            |
| GET              | `/api/projects/[id]/logs`                            | session      | paginated/filtered/searchable query                              |
| POST             | `/api/projects/[id]/logs/stream`                     | session+CSRF | **SSE** live log stream                                          |
| GET              | `/api/projects/[id]/logs/export`                     | session      | CSV/JSON export (≤ `EXPORT_CONFIG.MAX_LOGS` = 10000)             |
| GET              | `/api/projects/[id]/stats`                           | session      | aggregate stats                                                  |
| GET              | `/api/projects/[id]/stats/timeseries`                | session      | bucketed counts                                                  |
| GET              | `/api/projects/[id]/incidents`                       | session      | incident list                                                    |
| POST             | `/api/projects/[id]/incidents/stream`                | session+CSRF | **SSE** live incident stream                                     |
| GET              | `/api/projects/[id]/incidents/[incidentId]`          | session      | incident detail (status changes are a future spike, `plans/019`) |
| GET              | `/api/projects/[id]/incidents/[incidentId]/timeline` | session      | event timeline                                                   |

### SSE streams

Both stream endpoints are **POST** (CSRF-checked). They subscribe to `logEventBus`, emit batched `event: logs` / `event: incidents` plus heartbeats (windows/sizes in the Config table). Slow consumers **drop the batch but keep the connection open**; disconnect unsubscribes + clears timers.

### Pagination & query (`/api/projects/[id]/logs`)

- **Cursor-based** (preferred): keyset on `(timestamp DESC, id DESC)`, opaque base64url cursor; malformed → 400 `invalid_cursor`. `offset` accepted for back-compat but deprecated.
- `limit` clamped 1–500 (default 100); fetches `limit+1` for `has_more`/`nextCursor`.
- Filters: `level` (comma-separated), `from`/`to` (ISO 8601), `search` (full-text `to_tsquery('english', …)` against the `search` tsvector / GIN index).
- `total` uses bounded `cappedLogCount` (`total_is_capped`) on the first page only; skipped when a cursor is present.

---

## Log Ingestion + Incident Intelligence Data Path

Both ingest routes follow the same pipeline:

1. **Content-Type guard** → **API-key validation** (SHA-256 hash → project) → **re-verify the project row exists** (one extra read; a deleted project with a still-cached key must yield 401, not a 500 FK violation) → **per-project rate limit** (`INGEST_RPM` = 600/min; 429 carries `Retry-After: 60`, zero logs written).
2. **Parse/normalize** (OTLP via `normalizeOtlpLogsRequest` + attribute mapping; simple via `parseSimpleIngestRequest`). Batch capped at `BATCH_INSERT_LIMIT` = **100** → 400 `batch_too_large`. Invalid records are counted as `rejected` with per-record `errors`; the rest still ingest.
3. **Fingerprint + incident upsert** in one transaction (`prepareLogsForIncidents` → `upsertIncidentsForPreparedLogs` → `assignIncidentIds`). Fingerprint: normalize the message (lowercase/trim, mask UUIDs/hex/IPs/numbers, collapse whitespace — order is load-bearing), seed `service|sourceFile|lineNumber|normalizedMessage`, SHA-256 → 32-char hex. Incidents keyed `(projectId, fingerprint)`; upsert bumps `lastSeen`/`totalEvents`/`highestLevel`.
4. **Insert logs** with assigned `incidentId`/`fingerprint`. The `.returning(...)` explicitly lists every column except `search` (generated tsvector), with a deliberate `as any` (the `DatabaseClient` union breaks the overload).
5. **Broadcast** to the SSE bus → live UI.

**API keys** (`api-key.ts`): `lw_` + 32 url-safe chars, stored as **SHA-256 hex only** (plaintext shown once). In-process cache: positive 5 min, negative 30 s.

**Ingest pipeline** (`utils/ingest.ts:ingestLogs`): both `/v1` routes are thin adapters over one pipeline — shared guard → rate-limit → parse → transaction → broadcast. Adapters differ only in parsing (`parseOtlpIngestBody` / `parseSimpleIngestBody` → wide rows minus id/project/incident stamps). Both 429s return `{error,message}` + `Retry-After: 60` (SDKs key off status, not body). **Log-query module** (`utils/log-query.ts:queryLogs`): owns filter → where-clause → paged select for the logs route, export, and page loader (params-in/rows-out; throws `InvalidCursorError`, route maps to 400, loader falls back to first page). `cursor.ts`/`search.ts`/`capped-count.ts` stay until the incidents route migrates onto it. **Simple-ingest contract** (`/v1/ingest`): per-log failures do **not** fail the request — **200** `{accepted}`, plus `{rejected, errors[]}` when any record is rejected. Only batch-level problems return 4xx (`unsupported_media_type`, `invalid_json`, `validation_error`, `batch_too_large`, `unauthorized`, `rate_limited`). Metadata mapping: `request.id`→`requestId`, `enduser.id`→`userId`, `client.address`→`ipAddress`; top-level `service` → `serviceName` + `resourceAttributes."service.name"`; empty `{}` metadata stores as `NULL`.

**Incident grouping** is **error/fatal only**; other levels get `null` fingerprint/incidentId (but still get `serviceName`). `highestLevel` collapses via `LEVEL_RANK` (debug 10 … fatal 50). Status is **time-derived, never stored** (`getIncidentStatus(lastSeen)` vs `INCIDENT_AUTO_RESOLVE_MINUTES`); the client renders `data.autoResolveMinutes` from the server, so the two can't disagree.

The `search` tsvector is a Postgres **STORED generated column** using `||` + `COALESCE`, **not** `concat_ws` — a STORED column requires an IMMUTABLE expression and `concat_ws` is only STABLE. **Keep the expression in sync across three places**: `schema.ts` (`log.search`), the recreating migration (`drizzle/0010_*.sql`), and the `log_search_trigger` in `test-db.ts` (PGlite can't do STORED columns, so tests emulate via trigger).

---

## Database

- **Schema** (`schema.ts`) is the single source of truth. Tables: `project`, `incident`, `log`, plus better-auth `user`/`session`/`account`/`verification`. `log_level` = `debug|info|warn|error|fatal`.
  - `project.apiKeyHash` is SHA-256 only. `retentionDays`: `null` = system default, `0` = never delete, `>0` = days. **Names are unique PER OWNER, not globally** (intentional — prevents enumerating/squatting others' names).
  - `log` carries full OTLP fields plus app fields, the generated `search` tsvector (GIN), and FK to `incident` (`ON DELETE set null`).
  - `incident` upserts on `(projectId, fingerprint)`; `highestLevel` reuses the `log_level` enum. Heavy `log` indexing on project+timestamp, project+incident+timestamp, fingerprint, level.
- **Migrations** (`drizzle/`): edit `schema.ts` → `db:generate` → commit the SQL. **Prod/CI use `db:migrate` (idempotent, ordered) — never `db:push` in prod.** `entrypoint.sh` migrates at boot; CI `test-migrations` applies committed SQL against real Postgres. (Note: `drizzle/meta/` snapshots currently cover 0000–0005+0011 only — if `db:generate` proposes replaying old migrations, hand-write the SQL and keep the generated snapshot.)
- **Driver seam** (`db.ts`): `DatabaseClient = PostgresJsDatabase | PgliteDatabase`. Handlers use `getDbClient(locals)`; `getQueryRows` normalizes the drivers' raw-result shapes.

---

## Frontend (Svelte 5 runes)

- Pages under `src/routes/(app)/**` (guarded in `+layout.server.ts`); login is `src/routes/login/`.
- Stream hooks (`use-log-stream` / `use-incident-stream`) open the POST SSE endpoints and deliver batches via `onLogs`/`onIncidents` callbacks; pages push into local `$state`. Live list is capped client-side (`MAX_STREAMED_LOGS` = 10000 in `+page.svelte`).
  - ⚠ **Do not make the hooks' `_isConnected`/`_isConnecting` `$state`.** A component `$effect` both reads them (via `connect()` guards) and writes them — reactive state here self-triggers an `effect_update_depth_exceeded` loop that breaks hydration. Connection state reaches the UI **only** via `onConnectionChange`.
- UI = shadcn-svelte primitives in `src/lib/components/ui/` (vendor — excluded from coverage and knip).

---

## Shared Zod Schemas (the contract)

`src/lib/shared/schemas/` is the **single contract across client, server, and SDKs** — `project.ts` (name 1–50 chars, `^[a-zA-Z0-9_-]+$`; `retentionDays` null/0/1–3650), `log.ts` (`parseLevelFilter`, level enum), `incident.ts`. The level enum is mirrored in `schema.ts`'s `pgEnum` and the SDKs — change payload shapes here and the SDK types + DB enum move together.

---

## Config & Env Vars

`env.ts` validates at module load (throws aggregated `EnvValidationError`). `performance.ts` parses numeric tunables (clamped). `rate-limit.ts` reads RPM vars (fail-closed).

| Var                                                                        | Required    | Default           | Purpose                                                       |
| -------------------------------------------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                                                             | **yes**     | —                 | Postgres conn string (must start with `postgres`)             |
| `BETTER_AUTH_SECRET`                                                       | yes (prod)  | dev-only fallback | ≥32 chars; required unless `NODE_ENV=development` or `test`   |
| `ADMIN_PASSWORD`                                                           | for seeding | —                 | ≥8 chars; read by the seed script, not env-validated          |
| `ADMIN_USERNAME`                                                           | no          | `admin`           | seed username; email derived `<user>@logwell.local`           |
| `ORIGIN`                                                                   | no          | —                 | trusted origin for proxies/tunnels (better-auth); set in prod |
| `NODE_ENV`                                                                 | no          | `production`      | gates auth-secret strictness                                  |
| `RATE_LIMIT_INGEST_RPM`                                                    | no          | 600               | per-project ingest cap                                        |
| `RATE_LIMIT_LOGIN_RPM`                                                     | no          | 10                | per-IP login cap (**CI/e2e set 10000**)                       |
| `SSE_BATCH_WINDOW_MS` / `SSE_MAX_BATCH_SIZE` / `SSE_HEARTBEAT_INTERVAL_MS` | no          | 1500 / 50 / 30000 | SSE batching/heartbeat                                        |
| `LOG_STREAM_MAX_LOGS`                                                      | no          | 1000              | server-side stream bound (cap 10000)                          |
| `LOG_RETENTION_DAYS`                                                       | no          | 30                | system default retention (0 = disabled)                       |
| `LOG_CLEANUP_INTERVAL_MS`                                                  | no          | 3600000           | retention sweep interval                                      |
| `INCIDENT_AUTO_RESOLVE_MINUTES`                                            | no          | 30                | silence before auto-resolve                                   |

**Background jobs**: `cleanup-scheduler.ts` (started in hook init, stopped on graceful shutdown) runs `log-cleanup.ts` every `LOG_CLEANUP_INTERVAL_MS`, deleting logs past each project's effective retention (override else system default; `0` disables). `rate-limit.ts` evicts idle token buckets every 5 min.

---

## Testing Strategy (Testing Trophy — 4 tiers)

Tier by **filename suffix**, not directory. Playwright is excluded from Vitest.

| Tier        | Glob                                                                  | Env                                                     | DB                     | Command                    |
| ----------- | --------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------- | -------------------------- |
| Unit        | `src/**/*.unit.test.ts` (colocated)                                   | node                                                    | none/mocked            | `bun run test:unit`        |
| Component   | `src/**/*.component.test.ts`                                          | jsdom + `browser` condition + `@testing-library/svelte` | none                   | `bun run test:component`   |
| Integration | `tests/integration/**/*.integration.test.ts` + `scripts/**/*.test.ts` | node                                                    | **PGlite (in-memory)** | `bun run test:integration` |
| E2E         | `tests/e2e/**` (Playwright)                                           | real browser                                            | **real Postgres**      | `bun run test:e2e`         |

Shared setup: jest-dom + fallback `DATABASE_URL`/`BETTER_AUTH_SECRET` (`tests/setup.ts`); component-only `cleanup()` (`setup-component.ts` — its `.svelte` imports can't transform under node). Import test primitives from **`vite-plus/test`**, not `vitest`.

**Integration DB** (`test-db.ts`): boots fresh PGlite per test by **reflecting `schema.ts` into generated SQL** in FK order — it does **not** run `drizzle/*.sql` (sidesteps PGlite's STORED/`IMMUTABLE` incompatibility; tradeoff: not 100% Postgres parity, hence e2e on real Postgres). Workarounds: `search` via trigger, unique indexes as table constraints (for `ON CONFLICT`), `VARCHAR(255)`. If you add a column/table/enum, the type map / FK `tableOrder` may need updating or the table is silently skipped.

**Route testing pattern**: import `+server.ts` handlers, mock `RequestEvent` with `locals.db = <pglite>`, seed via `tests/fixtures/db.ts` factories (don't hand-roll inserts). Non-GET requests need a same-origin `Origin` header (most `createRequestEvent` helpers auto-add it) or CSRF 403s. **API-key tests must call `clearApiKeyCache()` in `beforeEach`** (in-process cache bleeds across tests).

**Two conventions before you refactor**: (1) timeseries, incident-detail, and incident-timeline tests **spy on `db.select` and throw on full-row pulls** — counts must aggregate in SQL, not JS. (2) `src/hooks.server.test.ts` re-implements session population against PGlite — it does **not** cover the rate-limit guard, fast-paths, or `svelteKitHandler`.

**E2E** (`playwright.config.ts`): CI runs built preview on **:4173**, local runs dev on **:5173**; `workers:1`, `retries:2`. Same-origin `Origin` via `extraHTTPHeaders` (CSRF). `chromium` + `firefox` locally, chromium-only in CI (`release.yml` runs both). Helpers: `helpers/otlp.ts` (bearer POST to `/v1/logs`), `helpers/log-selectors.ts` (viewport-aware locators). Admin `admin`/`adminpass` matches the seed script. Login specs must wrap fill+submit+assert in `expect(…).toPass({ timeout: 45000 })` (hydration race) with `RATE_LIMIT_LOGIN_RPM=10000` so retries aren't 429'd. (One "redirect authenticated users away from login" test is `test.skip`'d pending a session-cookie issue.)

---

## SDKs (`sdks/`)

Independent packages, same **Client → Queue → Transport** architecture (TS is the reference; Python/Go mirror it file-for-file: `client` / `queue` / `transport` / `config` / `types` / `errors` / `source(-location)`).

| SDK        | Dir                | Build                               | Test                                         | Lint                         | Types                                  | Publishes to                                  |
| ---------- | ------------------ | ----------------------------------- | -------------------------------------------- | ---------------------------- | -------------------------------------- | --------------------------------------------- |
| TypeScript | `sdks/typescript/` | `vp pack` (tsdown; CJS+ESM+`.d.ts`) | Vitest (`test:unit`, `test:integration`)     | `vp check`                   | via `vp check`; `attw`, `size` (<10KB) | **npm** `logwell` + **JSR** `@divkix/logwell` |
| Python     | `sdks/python/`     | `hatchling` / `python -m build`     | `pytest` (`tests/unit`, `tests/integration`) | `ruff check` / `ruff format` | `mypy --strict`                        | **PyPI** `logwell`                            |
| Go         | `sdks/go/`         | `go build` (stdlib only, zero deps) | `go test -race ./...`                        | `golangci-lint`              | `go vet`                               | `go get github.com/Divkix/Logwell/sdks/go@…`  |

Python: `cd sdks/python && uv venv && uv pip install -e ".[dev]"`. Go: `cd sdks/go && go test ./...`. SDK integration tests need a running server.

**Shared contract** (keep aligned across all three):

- **Wire**: `POST {endpoint}/v1/ingest`, `Authorization: Bearer <apiKey>` + JSON, **raw JSON array** body (no envelope), camelCase (`sourceFile`, `lineNumber`).
- **Config**: defaults `batchSize 50`, `flushInterval 5000ms`, `maxQueueSize 1000`; bounds `batchSize ≤ 100` (server limit), `maxQueueSize ≤ 100000`. Flush floor 100ms is enforced by TS+Go; Python currently only rejects `≤0`.
- **Queue**: bounded; overflow drops the **oldest** + `onError(QUEUE_OVERFLOW)`; send failure **re-queues the undelivered remainder in order** and retries.
- **Shutdown**: TS throws `NETWORK_ERROR` if logs remain undelivered; Go returns the flush error; Python reports via `on_error` only.
- **Errors** (`LogwellError(message, code, statusCode?, retryable)`), 7 codes: retryable = `NETWORK_ERROR`, `SERVER_ERROR`-from-5xx, `RATE_LIMITED`/429; non-retryable = `UNAUTHORIZED`/401, `VALIDATION_ERROR`/400, `QUEUE_OVERFLOW`, `INVALID_CONFIG`. (`SERVER_ERROR` is also reused for unexpected 4xx as non-retryable.)
- **Per-language notes**: Python's queue runs a daemon asyncio loop on its own thread; Go `Child()` shares the root's queue/transport and `Child.Shutdown()` is a no-op (shut down the root). TS never echoes the `apiKey` in errors; Python includes a truncated prefix. npm `logwell` ships built `./dist`, JSR `@divkix/logwell` exports raw `./src/index.ts`; pack config lives in the SDK `vite.config.ts` (`fixedExtension: false` matches the `exports` map).

---

## Tooling

- **Vite+ / `vp`** (`vite.config.ts`): `vp check` = format+lint+typecheck (`--fix` to fix). Inline disable: `// oxlint-disable-next-line <rule>`. Pinned exact: **Vite+ 0.2.9**, **vitest 4.1.10** (via `overrides`), **@vitest/coverage-v8 4.1.10** (Vite+ hard-fails coverage when the provider differs from the bundled runner — never let the `^` range float it). Root keeps `typescript` 6 + `@typescript/native` 7 for `svelte-check --tsgo` (svelte-check 4.x hard-fails on TS 7 as the main compiler). Don't bump casually.
- **knip** (`knip.json`): entries cover SvelteKit route files + `db/index.ts`, `auth.ts`, `cleanup-scheduler.ts`; ignores for `simple-ingest.ts` types and vendor deps. Run pre-commit.
- **husky** (`.husky/`): installed via `prepare` (`vp config && husky && svelte-kit sync`). `.husky/pre-commit` runs `vp check && bun run knip` (plus a conditional TS-SDK check); `.vite-hooks/pre-commit` runs the lighter `vp staged`.
- **seed-admin** (`scripts/seed-admin.ts`): idempotent admin creation via better-auth; email auto-derived `<user>@logwell.local` (`.local` because `localhost` fails email validation).
- **Pinned versions**: Bun `1.4.1` (CI `setup-bun` + Docker `oven/bun:1.4.1-alpine` with digest). Postgres `18-alpine` everywhere (PG 19 is beta-only; don't bump to a beta). Pinning is for reproducible builds.

---

## CI/CD (`.github/workflows/`)

Bun-based workflows (`ci`, `release`, `sdk-typescript`) checkout with `persist-credentials: false` and `bun install --frozen-lockfile` (Go/Python workflows use their own toolchains). CI env: real-Postgres `DATABASE_URL`, placeholder `BETTER_AUTH_SECRET`, `CI=true`.

- **`ci.yml`** (push to `main` non-tags, PRs): `lint` (lint + `prepare` + `check`); unit/component/integration (**3 shards** each); v8 coverage; e2e **chromium-only**, 3 shards — real Postgres service, `drizzle-kit push --force`, seeded admin (`adminpass`), `RATE_LIMIT_LOGIN_RPM=10000`; `test-migrations` (committed SQL vs real Postgres); `build` (`bun --bun run build`); `docker-build` (no push). `docker-publish`/`docker-merge` run on **main push only** (amd64 + arm64 by digest → GHCR tags `dev`, `dev-<sha>`, `<sha>`). `ci-success` gates.
- **`release.yml`** (push tag `v*`, or manual; `cancel-in-progress: false`): re-runs lint + unit + integration + e2e on **chromium AND firefox** × 3 shards, then multi-arch image + GitHub Release (tags `version` + `latest`).
- **SDK workflows** (path-filtered to `sdks/<lang>/**`, push/PR to `main`): TS — lint (stubs `.svelte-kit/tsconfig.json` for the root tsconfig), unit+integration, build + `attw` + `size`; Python — ruff, `mypy --strict`, pytest matrix (3.10–3.13), coverage signal-only, `twine check`; Go — golangci-lint (v2.10.1), `go test -race` on **1.26.x**, no publish job. Publish jobs (main push, OIDC) check the registry and skip if the version exists — idempotent re-runs.
- **`dependabot.yml`**: weekly updates across 6 ecosystems (grouped minors/patches, svelte + testing groups, majors separate), prefix `deps`.

Coverage is signal-only (threshold gate removed per #207 — fewer tests at useful places beat more tests at useless ones); e2e-tested routes and shadcn primitives excluded from the report.

---

## Build & Deploy

- **Build**: `vp build` → `svelte-adapter-bun` emits a Bun server in `build/` (entry `build/index.js`). Prod listens on **3000** (preview is 4173; dev 5173).
- **Dockerfile** (multi-stage, pinned `oven/bun:1.4.1-alpine` + digest): prod-deps → full-deps+`prepare` → build (least-to-most-volatile copies, `NODE_ENV=production`) → release. Browser downloads skipped; `curl` for healthcheck.
- **`entrypoint.sh`**: `drizzle-kit migrate` (aborts on failure) → seed admin **only if `ADMIN_PASSWORD` is set** (fails fast on seed error) → `exec bun run ./build/index.js`.
- **`compose.yaml`**: local Postgres 18-alpine (`root`/`mysecretpassword`/`local` on 5432, `pgdata` volume, `pg_isready` healthcheck).
- **PaaS**: any OCI host with `DATABASE_URL` + `BETTER_AUTH_SECRET` (+ `ORIGIN` behind a proxy/tunnel). Migrations run on boot.

---

## Release Process

App and SDKs version **independently**. Commits/tags are GPG-signed — signing must work locally. Two trigger models:

- **App → tag-triggered**: merging to `main` does NOT release; pushing `v*` does (`release.yml` → images + GitHub Release). Bump root `package.json` `version`, merge, then `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push origin vX.Y.Z`. (`bun.lock` doesn't record the app version — no lockfile churn.)
- **SDKs (TS/Python) → merge-triggered**: pushing a version bump under `sdks/<lang>/**` to `main` publishes whatever version is new; `sdks/…@vX.Y.Z` tags are git markers only. Publish jobs are idempotent (skip if the version exists).
  - **TS**: bump **BOTH** `sdks/typescript/package.json` (`version`, npm) and `sdks/typescript/jsr.json` (`version`, JSR) — they desync silently otherwise.
  - **Python**: bump `pyproject.toml` `version`, then `cd sdks/python && uv lock` (lockfile records it; CI-adjacent check).
  - **Go**: no publish job — tag `sdks/go/vX.Y.Z` (slash format) so `go get github.com/Divkix/Logwell/sdks/go@vX.Y.Z` resolves.

---

## Decision Log & Roadmap (`plans/`)

`plans/` is the durable decision record from the `improve` audit — self-contained handoff plans, each tied to a finding ID. Plans **001–016 are done**; **017–020 are open SPIKEs** (design a vertical slice behind a flag, then STOP at a go/no-go gate; do **not** full-build):

| Spike | Direction                                                                           |
| ----- | ----------------------------------------------------------------------------------- |
| 017   | Incident alerting — outbound webhooks / Slack on new incidents                      |
| 018   | Programmatic read/query API + read-capable SDKs                                     |
| 019   | Incident lifecycle — acknowledge / mute / manual resolve (core-table schema change) |
| 020   | Backup-grade export (full-fidelity, uncapped, restorable)                           |

Details live in `plans/README.md` (status table, 005→014 dep graph, shared-design notes, "Considered and rejected" ledger). Before roadmap work, read the relevant plan and **re-run its drift check**.

---

## Common Gotchas

1. **`db:migrate` vs `db:push`**: prod/CI-real-Postgres apply committed migrations; `push` is dev/ephemeral only. After `schema.ts` edits, `db:generate` + commit the SQL.
2. **`db:generate` needs a TTY and diffs the latest `drizzle/meta/*_snapshot.json`**: if it prompts about unrelated columns or replays old migrations, hand-write the SQL and keep the generated snapshot.
3. **Local `bun run build` needs env**: dummy `DATABASE_URL` + `BETTER_AUTH_SECRET` or env validation fails the build.
4. **API keys are hash-only + write-only**: plaintext shown once at create/regenerate (`seedProjectWithApiKey` in tests); keys can't read anything (no read API by design).
5. **Per-log ingest errors aren't request failures**: `/v1/ingest` returns **200** `{accepted, rejected, errors[]}`; only batch-level issues (auth, rate-limit, `invalid_json`, `batch_too_large`) return 4xx.
6. **CSRF on `/api`**: any request other than GET/HEAD/OPTIONS **without** `Origin`/`Referer` is 403 (`/v1` exempt). Hand-built test `Request`s must add `Origin`.
7. **SSE bus + rate limiter are in-memory / single-process**: no fan-out across replicas.
8. **e2e prerequisites**: real Postgres + seeded admin; login specs need the `toPass()` retry pattern and `RATE_LIMIT_LOGIN_RPM=10000`; local runs chromium+firefox unless `--project` is passed.
9. **`test-db.ts` approximations**: reflection (not `drizzle/*.sql`), `VARCHAR(255)`, unique indexes as constraints. New column types may need the type map / FK `tableOrder` updated or the table is silently skipped.
10. **Don't copy `tests/integration/api/health/health.integration.test.ts`'s inline `CREATE TABLE`** — bespoke legacy setup (`api_key` column), not the shared `setupTestDatabase()` path.
11. **better-auth minors can add required columns**: 1.7 added `account.issuer` (NOT NULL + unique). Symptom: `BetterAuthError: The field "…" does not exist…` → add the column + a backfilling migration (`'local:' || provider_id`) before `SET NOT NULL`.
12. **Login rate-limit is socket-IP by default**: `getClientAddress()` ignores `X-Forwarded-For` unless `ADDRESS_HEADER` is configured (depth-indexed from the right via `XFF_DEPTH`). Behind a proxy, set both or per-IP limiting won't see real client IPs.
13. **Pinned Vite+/Bun/Postgres versions** are intentional; don't bump without reason.

## Agent skills

- Issues: GitHub Issues (`Divkix/Logwell`); external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.
- Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- Domain docs: planned layout is one root `CONTEXT.md` plus `docs/adr/` (not yet present). See `docs/agents/domain.md`.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
