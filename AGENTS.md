# Repository Guidelines

## Project Overview

Self-hosted, single-tenant logging + incident-intelligence platform. Services ship logs via OTLP/HTTP JSON (`POST /v1/logs`) or simple JSON (`POST /v1/ingest`) with per-project API key (`Bearer lw_…`); logs store in PostgreSQL with full-text search, error/fatal logs auto-group into fingerprinted incidents, live dashboard streams via SSE.

## Architecture & Data Flow

- **Request lifecycle** (`src/hooks.server.ts`): build guard → `initAuth()` + cleanup scheduler → `locals.db` injection → login rate-limit → signup kill-switch (403) → `/v1/*`, `/api/health` skip session → session resolve + better-auth handler + CSRF.
- **Two API families — do not conflate:**
  - `/api/**`: session cookie + project ownership, CSRF on non-GET/HEAD/OPTIONS. Dashboard backend.
  - `/v1/**`: API-key auth, per-project rate limit (`INGEST_RPM=600/min`, 429 + `Retry-After: 60`), CSRF-exempt.
- **Ingest pipeline** (`src/lib/server/utils/ingest.ts:ingestLogs`): Content-Type guard → key validation (SHA-256 → project, re-verify row exists) → rate-limit → parse/normalize → fingerprint + incident upsert in one tx → `insert` with `incidentId` → SSE broadcast. `/v1` routes are thin adapters (`parseOtlpIngestBody` / `parseSimpleIngestBody`).
- **Incidents:** error/fatal only; fingerprint = `SHA-256(service|sourceFile|lineNumber|normalizedMessage)[:32]`, normalize = lowercase/trim, mask UUIDs/hex/IPs/numbers, collapse whitespace (order load-bearing). Upsert on `(projectId, fingerprint)` bumps `lastSeen`/`totalEvents`/`highestLevel` (`LEVEL_RANK`: debug 10 … fatal 50). Status is time-derived (`getIncidentStatus(lastSeen)` vs `INCIDENT_AUTO_RESOLVE_MINUTES`), never stored.
- **SSE bus** (`src/lib/server/events.ts`): in-process singleton, project-scoped listeners. `POST …/logs/stream`, `POST …/incidents/stream` (POST for CSRF). Batched `event: logs/incidents` + heartbeats; slow consumers drop batch, keep connection. Single-process — no cross-replica fan-out (same for rate limiter).
- **Auth:** better-auth `username()` plugin, 7d sessions, lazy `createAuth(db)` proxy (throws before `initAuth()`). Prod code MUST use `auth.api.getSession()`; `src/lib/server/session.ts` is test-only (unsigned cookie, forgeable).

## Key Directories

- `src/routes/(app)/`: guarded dashboard pages (`+layout.server.ts` session guard); `src/routes/login/`, `src/routes/api/`, `src/routes/v1/`
- `src/lib/server/`: `auth.ts`, `db/`, `config/env.ts`, `config/performance.ts`, `jobs/`, `utils/ingest.ts`, `utils/log-query.ts`, `utils/api-key.ts`, `utils/csrf.ts`, `utils/rate-limit.ts`, `utils/cursor.ts`, `utils/search.ts`, `events.ts`, `error-handler.ts`, `owned-project.ts`
- `src/lib/shared/schemas/`: Zod contract — `project.ts`, `log.ts`, `incident.ts` (client/server/SDKs single source)
- `src/lib/stores/`, `src/lib/hooks/use-log-stream`, `use-incident-stream`: POST SSE consumers, `onLogs`/`onIncidents` callbacks
- `src/lib/components/ui/`: shadcn-svelte vendor — don't test, excluded from coverage/knip
- `tests/integration/`, `tests/e2e/`, `tests/fixtures/db.ts`: PGlite tests, Playwright specs, seed factories
- `scripts/`: `seed-admin.ts`, `backfill-incidents.ts`; `sdks/typescript|python|go/`; `drizzle/` committed SQL; `plans/` decision log (001–016 done, 017–020 open spikes)

## Development Commands

Always `bun run …` (`bun.lock`, `packageManager bun@1.4.1`). Ports: dev **5173**, preview **4173**, prod **3000**.

```bash
bun run dev / build / preview        # vp dev/build (svelte-adapter-bun → build/index.js, prod :3000)
bun run lint                         # vp check (= format+lint+typecheck); --fix to fix
bun run check                        # svelte-kit sync + svelte-check --tsgo
bun run knip                         # dead code — run pre-commit with vp check
bun run test:unit / :component / :integration  # vp test run --project <tier>
bun run test:coverage                # v8, signal-only (no gate)
bun run test:e2e                     # Playwright; needs real Postgres + seeded admin
bun run db:start / db:stop           # docker compose up -d / down -v (postgres:18-alpine)
bun run db:generate / db:migrate     # after schema edit commit SQL; migrate in prod/CI, never push
bun run db:push                      # dev/ephemeral only
bun run db:seed / incidents:backfill # seed needs ADMIN_PASSWORD (≥8 chars)
bun run sdk:test / sdk:build / sdk:lint  # delegates to sdks/typescript
```

Local build needs dummy env: `DATABASE_URL=postgres://… BETTER_AUTH_SECRET=<≥32 chars> bun run build`.

## Code Conventions & Common Patterns

- **DB seam:** handlers never import DB directly. Use `getDbClient(event.locals)` (`src/lib/server/db/db.ts`); tests overwrite `locals.db` with PGlite. `DatabaseClient = PostgresJsDatabase | PgliteDatabase`; `.returning()` lists columns explicitly minus `search`, with deliberate `as any`.
- **Ownership guards** (`owned-project.ts`): `requireAuth` → 401 `/api/*`, 303 pages. `requireOwnedProjectRoute` (JSON 404 `Response`, check `instanceof Response`) vs `requireOwnedProjectPage` (`error(404)`). Ownership miss = **404 not 403**. CSRF runs before ownership on mutating routes.
- **CSRF:** `/api` non-GET without `Origin`/`Referer` → 403. Test `Request`s must set same-origin `Origin`. `/v1` exempt.
- **Ingest contract:** `/v1/ingest` per-log failures ≠ request failure → **200** `{accepted, rejected, errors[]}`. Only batch-level → 4xx (`unauthorized`, `rate_limited`, `invalid_json`, `batch_too_large` at 100, `validation_error`). Both 429s carry `Retry-After: 60`.
- **Query:** cursor-preferred keyset `(timestamp DESC, id DESC)`, base64url opaque; malformed → 400 `invalid_cursor`. `limit` 1–500 (default 100), `limit+1` for `has_more`. `offset` back-compat deprecated. `total` via bounded `cappedLogCount` first page only. Filters: `level` CSV (`parseLevelFilter`), `from`/`to` ISO, `search` → `to_tsquery('english',…)` on `search` tsvector/GIN.
- **Schema sync:** `search` STORED generated column uses `||` + `COALESCE`, not `concat_ws` (STABLE, illegal in STORED). Keep in sync: `schema.ts` + recreating migration `drizzle/0010_*.sql` + `log_search_trigger` in `test-db.ts`.
- **Svelte 5:** never make hooks' `_isConnected`/`_isConnecting` `$state` — `$effect` read+write self-triggers `effect_update_depth_exceeded`. UI gets connection only via `onConnectionChange`. Live list capped client-side (`MAX_STREAMED_LOGS=10000`).
- **Naming:** `requireOwnedProject*`, `parse*IngestBody`, `*Error` (`InvalidCursorError`), `*.unit.test.ts` colocated / `*.integration.test.ts` / `*.component.test.ts`. `// oxlint-disable-next-line <rule>` for inline suppress.
- **Errors:** server logs full context, client gets sanitized message + error ID (`error-handler.ts`).

## Important Files

- `src/hooks.server.ts`: lifecycle, rate-limit, CSRF, DB injection
- `src/lib/server/auth.ts:12-28`: better-auth options; `src/lib/server/db/schema.ts`: tables/types source of truth; `src/lib/server/db/db.ts`: injection seam; `src/lib/server/db/test-db.ts`: PGlite reflection engine
- `src/lib/server/utils/ingest.ts`, `log-query.ts`, `api-key.ts` (`lw_` + 32 chars, SHA-256 hex only, cache 5m/30s neg), `otlp.ts`, `simple-ingest.ts`, `incidents.ts`, `rate-limit.ts`, `cursor.ts`, `search.ts`
- `src/lib/server/events.ts`, `error-handler.ts`, `owned-project.ts`
- `src/lib/shared/schemas/project.ts` (name `^[a-zA-Z0-9_-]+$` 1–50, `retentionDays` null/0/1–3650), `log.ts`, `incident.ts`
- `src/routes/v1/logs/+server.ts`, `v1/ingest/+server.ts`, `api/projects/[id]/logs/+server.ts`, `logs/stream/+server.ts`, `incidents/stream/+server.ts`
- `drizzle/` SQL + `compose.yaml` + `Dockerfile` + `entrypoint.sh` (migrate → seed if `ADMIN_PASSWORD` → `bun ./build/index.js`)
- `vite.config.ts` (vp: staged `vp check --fix`, lint ignores `sdks/**`), `knip.json`, `.husky/pre-commit` (`vp check && bun run knip`)

## Runtime/Tooling Preferences

- **Bun only** (`engines >=1.2.0`, pinned `1.4.1` in CI + Docker `oven/bun:1.4.1-alpine`); `pnpm`/`npm` last resort. One-off CLIs: `bunx → pnpm dlx → npx`.
- **Vite+ (`vp`) 0.3.1**, **vitest 4.1.11** via `overrides`, `@vitest/coverage-v8` must match runner (hard-fail otherwise). Root TS 6 + `@typescript/native` 7 for `--tsgo` (svelte-check 4.x rejects TS7 main). `vite`/`vitest`/`@vitest/*` bumps via `vp migrate` only.
- **Postgres 18-alpine** everywhere (PG19 beta — don't bump). `db:push` dev-only; prod/CI `db:migrate`. `db:generate` needs TTY; if it replays old migrations (meta snapshots cover 0000–0005+0011), hand-write SQL.
- Env: `DATABASE_URL` (must start `postgres`, required), `BETTER_AUTH_SECRET` (≥32, required unless dev/test), `ORIGIN` (prod proxies), `RATE_LIMIT_*_RPM`, `SSE_*`, `LOG_*`, `INCIDENT_AUTO_RESOLVE_MINUTES=30`. Behind proxy set `ADDRESS_HEADER` + `XFF_DEPTH` or IP limiting sees socket IP.
- Never commit/push/rebase unless asked; never `reset --hard`, `clean -fd`, print secrets.

## Testing & QA

Tier by **filename suffix** (Playwright excluded from Vitest). Import from `vite-plus/test`, not `vitest`.

| Tier        | Glob                                                                  | DB            | Command                    |
| ----------- | --------------------------------------------------------------------- | ------------- | -------------------------- |
| Unit        | `src/**/*.unit.test.ts`                                               | mocked        | `bun run test:unit`        |
| Component   | `src/**/*.component.test.ts` (jsdom + Testing Library)                | none          | `bun run test:component`   |
| Integration | `tests/integration/**/*.integration.test.ts` + `scripts/**/*.test.ts` | PGlite        | `bun run test:integration` |
| E2E         | `tests/e2e/**`                                                        | real Postgres | `bun run test:e2e`         |

- **Integration:** fresh PGlite per test via schema reflection (not `drizzle/*.sql`); new column types may need `test-db.ts` type map / `tableOrder` or table silently skipped. Seed via `tests/fixtures/db.ts` (`seedProject`, `seedLog`, `seedProjectWithApiKey` — plaintext once); add same-origin `Origin`; `clearApiKeyCache()` in `beforeEach`. Don't copy `health.integration.test.ts` inline `CREATE TABLE` (legacy `api_key` col).
- **Conventions before refactor:** timeseries/incident-detail/timeline tests spy on `db.select` and throw on full-row pulls — aggregate in SQL. `hooks.server.test.ts` covers session population only, not rate-limit/fast-paths.
- **E2E:** CI preview `:4173`, local dev `:5173`, `workers:1 retries:2`, `extraHTTPHeaders` Origin, admin `admin/adminpass`, `RATE_LIMIT_LOGIN_RPM=10000`, login specs wrap in `expect(…).toPass({timeout:45000})`. Helpers: `helpers/otlp.ts`, `helpers/log-selectors.ts`. Chromium+firefox local, chromium-only CI.
- Pre-commit: `vp check && bun run knip` (+ `bun run check` for Svelte/TS). Run nearest tier for touched code. Coverage signal-only.
