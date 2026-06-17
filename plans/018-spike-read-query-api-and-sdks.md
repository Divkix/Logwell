# Plan 018 (SPIKE): Programmatic read/query API + read-capable SDKs

> **Nature**: DESIGN + SPIKE plan. Validate the auth + endpoint shape with a
> thin vertical slice, then STOP at the "Spike exit" gate for a go/no-go. Do
> NOT build out all three SDKs or a full query language in the spike.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/api/projects src/routes/v1 src/lib/server/utils/api-key.ts sdks/` — re-read changed files before relying on "Current state".

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED (introduces a NEW authenticated read surface — security-sensitive)
- **Depends on**: independent. Benefits from plan 013 (capped count) and plan 012 (narrowed returning) since a programmatic read API will hit those same query paths harder.
- **Category**: direction / feature
- **Planned at**: commit `8ec01b0`, 2026-06-17

## The opportunity

Logwell's SDKs are **write-only** (`sdks/typescript`, `sdks/python`, `sdks/go` all do ingest/batch/flush). The only way to READ logs/incidents back is the browser UI, because the read endpoints are **session/cookie authenticated**. There is no supported way to query your own logs programmatically (CI checks, dashboards, scripts, "did this error happen in prod?" automation). Closing this turns Logwell from a write-only sink into a queryable platform.

## Current state (the auth split that defines the work)

- **Ingest** (`/v1/ingest`, `/v1/logs`) → **API-key auth** via `validateApiKey` (Bearer project API key). This is the machine-facing surface.
- **Read** (`/api/projects/[id]/logs`, `/api/projects/[id]/incidents`, stats, timeseries) → **session auth** via `requireProjectOwnership` (cookie + ownership). Browser-only.
- **There is no API-key-authenticated READ endpoint.** That's the core gap. The read logic already exists and is solid (cursor pagination, level/time/search filters in `logs/+server.ts`); it's just gated behind the wrong auth for programmatic use.

So the spike is mostly about **exposing existing read logic under API-key auth safely**, NOT writing new query logic.

## Design decisions to resolve in the spike

1. **New endpoints vs. dual-auth existing ones.** Strongly prefer NEW endpoints under `/v1/` (e.g. `GET /v1/logs`, `GET /v1/incidents`) that use `validateApiKey`, reusing the existing query-building code. Do NOT bolt API-key auth onto the `/api/*` session routes (mixing auth models on one route is a footgun). Factor the shared query logic (filter/cursor building from `logs/+server.ts`) into a reusable function both the session route and the new `/v1` route call.
2. **Scope of the API key.** Today an API key authorizes INGEST for one project. Does the same key authorize READ for that project? Decide: reuse the same key (simplest, and ownership is per-project anyway) vs. introduce read-scoped keys (more secure, more work). For the spike, reuse the same project key for read of THAT project; flag scoped/read-only keys as a real-build option.
3. **Response contract.** Mirror the existing `/api/.../logs` JSON shape (`{ logs, total, has_more, nextCursor }`) so the UI and SDK share one mental model. Coordinate with plan 013 (capped `total`) — the programmatic API should expose `total_is_capped` too.
4. **Rate limiting.** Reads can be expensive (search + count). Apply the existing token-bucket (`rate-limit.ts`) to the read endpoints, keyed per project, with its own RPM env var. Required, not optional.
5. **SDK surface.** A minimal read method per SDK: `client.queryLogs({ level, from, to, search, cursor, limit })` returning a typed page. The spike implements it in ONE SDK (TypeScript, the most-developed) to validate the contract; Python/Go follow in the full build.

## Scope of the SPIKE (vertical slice)

**In scope**:

- Factor the logs query/filter/cursor builder out of `src/routes/api/projects/[id]/logs/+server.ts` into a shared server util (no behavior change to the existing route — it now calls the util).
- Add ONE new endpoint: `GET /v1/logs` (API-key auth via `validateApiKey`, project derived from the key), reusing the shared util, with rate limiting.
- Integration tests: API-key read returns the caller's logs; rejects missing/invalid key (401); respects level/time/search/cursor filters; is rate-limited (429); CANNOT read another project's logs.
- Add `queryLogs(...)` to the TypeScript SDK with a unit/integration test against a running server.
- Docs: a "Reading logs via API" section (endpoint, auth, params, example) + SDK usage.

**Explicitly OUT of scope for the spike**:

- `GET /v1/incidents` and stats/timeseries programmatic endpoints (follow the same pattern once `/v1/logs` is validated).
- Python and Go read methods (do them in the full build after the contract is locked).
- Read-scoped / separate API keys.
- A query DSL or aggregation API (only the existing filter set).

## Spike steps

### Step 1: Extract the shared logs-query builder

Pull the WHERE/cursor/filter construction from `logs/+server.ts` into e.g. `src/lib/server/utils/log-query.ts` (`buildLogQuery(params)` → conditions + pagination). Refactor the existing session route to call it. This must be behavior-preserving.

**Verify**: `bun run test:integration -- logs` passes unchanged (the session route still works identically).

### Step 2: Add `GET /v1/logs` under API-key auth

Create `src/routes/v1/logs/query/+server.ts` (or an appropriate path that doesn't collide with the existing OTLP `POST /v1/logs`) implementing `GET` with `validateApiKey`, deriving `projectId` from the key, calling the shared builder, and applying `checkRateLimit`. Return the same JSON contract as the session route.

NOTE: `/v1/logs` already exists as the OTLP ingest POST. Decide the path carefully — options: `GET /v1/logs` (same path, different method — clean REST but verify the router allows method-split handlers in one file), or a distinct path like `GET /v1/query/logs`. Validate which the SvelteKit router supports cleanly and pick the least surprising.

**Verify**: new integration tests pass (read returns logs, filters work, 401 on bad key, 429 when rate-limited, no cross-project read).

### Step 3: TypeScript SDK read method

Add `queryLogs(opts)` to the TS SDK returning a typed page (`{ logs, total, hasMore, nextCursor, totalIsCapped }`). Keep the bundle under the existing size budget (`bun run size` < 10KB). Add a unit test (mocked fetch) and an integration test (against a running server, like the existing SDK integration tests).

**Verify**: `bun run sdk:test` passes; `bun run sdk:build` + `bun run size` within budget; `attw` clean.

### Step 4: Document + validate

Docs section + run everything.

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → pass; `bun run knip` → no new unused; SDK checks green.

## Spike exit (go/no-go gate)

STOP and report:

- Final auth decision (same key for read vs. scoped keys) and why.
- Final endpoint path/method decision and any router constraints found.
- The locked response contract (so Python/Go can implement identically).
- Security review notes: confirm the API-key read path enforces per-project isolation exactly as ingest does, and that rate limiting is in place.
- Effort estimate for `/v1/incidents` + Python/Go read methods.
- Go/no-go recommendation.

## Done criteria (for the SPIKE)

- [ ] Logs query logic is factored into a shared util used by BOTH the session route and the new `/v1` read route (no duplicated filter logic)
- [ ] Existing session logs route behavior unchanged (`bun run test:integration -- logs` green)
- [ ] `GET` programmatic logs endpoint exists under API-key auth with rate limiting
- [ ] Integration tests prove: valid key reads own logs; 401 on bad/missing key; filters honored; 429 when limited; CANNOT read another project's logs
- [ ] TypeScript SDK has `queryLogs(...)` with tests; bundle within size budget; `attw` clean
- [ ] Docs cover endpoint + SDK usage
- [ ] `bun run test:integration`, `bun run check`, `vp check`, `bun run knip`, `bun run sdk:test` all green
- [ ] Written go/no-go report with locked contract
- [ ] `plans/README.md` status row updated

## STOP conditions

- The SvelteKit router cannot cleanly host both `POST /v1/logs` (OTLP ingest) and a `GET` reader without ambiguity → pick a distinct path and report.
- Reusing the ingest API key for reads is deemed a security risk for the target deployments → STOP and surface the scoped-key decision before building SDK methods against a contract that will change.
- The shared-builder extraction changes session-route behavior (tests fail) → fix to be behavior-preserving before adding the new route.
- Per-project isolation cannot be proven for the API-key read path → STOP (this is the security-critical invariant).

## Maintenance / full-build notes

- Once `/v1/logs` read is validated: add `/v1/incidents`, then stats/timeseries; implement `queryLogs` in Python + Go against the locked contract; consider read-only scoped keys.
- Keep the programmatic and session read paths sharing the SAME query builder so filters never drift (this is the whole reason for Step 1).
- A programmatic read API makes plan 013's capped count and plan 012's narrowed returning more important (machine clients can hammer these paths) — note the dependency direction.
- Versioning: the `/v1` prefix already signals an API contract; treat the read response shape as a published contract once SDKs depend on it.
