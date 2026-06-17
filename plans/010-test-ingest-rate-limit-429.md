# Plan 010: Add integration tests proving rate-limit 429 wiring on the ingest endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/v1/ingest/+server.ts src/routes/v1/logs/+server.ts src/lib/server/utils/rate-limit.ts tests/integration/simple-ingest tests/integration/otlp` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

Ingestion is the highest-volume, most abuse-prone surface. The token-bucket limiter is unit-tested (`rate-limit.unit.test.ts`), but **nothing proves the endpoints actually call it**: that a rate-limited request returns 429 with `Retry-After: 60`, that it does NOT write logs/incidents, and that the limit is isolated per project key. A refactor could silently drop the guard and every existing test would still pass. These integration tests lock the wiring in place.

## Current state

**`src/routes/v1/ingest/+server.ts`** — rate-limit check (around lines 56–63), AFTER api-key validation, BEFORE body parse/insert:

```ts
// Apply rate limiting per project
if (!checkRateLimit(`ingest:${projectId}`, INGEST_RPM)) {
  return json(
    { error: "rate_limited", message: "Rate limit exceeded. Retry in 60 seconds." },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}
```

**`src/routes/v1/logs/+server.ts`** — rate-limit check (around lines 64–70), note the body shape differs (no `message`):

```ts
if (!checkRateLimit(`ingest:${projectId}`, INGEST_RPM)) {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  });
}
```

(The body-shape inconsistency between the two — `/v1/ingest` returns `{error, message}`, `/v1/logs` returns `{error}` — is a known minor nit recorded in `plans/README.md` → "Minor items, not separately planned". Do NOT fix it here; just assert each endpoint's actual current shape.)

**The limiter** — `src/lib/server/utils/rate-limit.ts`:

- `checkRateLimit(key, rpm)` — token bucket keyed by string, capacity = `rpm`. Returns `true` if allowed, `false` if limited.
- `INGEST_RPM` default 600 (env `RATE_LIMIT_INGEST_RPM`). The bucket is module-level global state keyed by `ingest:${projectId}`.
- There is **no exported reset** for the bucket map. To make a 429 deterministic without sending 600 requests, set the env var `RATE_LIMIT_INGEST_RPM` LOW — but note `INGEST_RPM` is read once at module load, so setting env at runtime won't change the already-imported constant.

**Key testing constraint**: `INGEST_RPM` is captured at import time. The cleanest deterministic approach is to call the endpoint repeatedly until limited is impractical at 600. Instead, **pre-exhaust the bucket directly** by calling the exported `checkRateLimit(\`ingest:${projectId}\`, INGEST_RPM)`in a loop until it returns`false`, THEN invoke the endpoint and assert 429. Since the endpoint uses the same module-level bucket map and the same `INGEST_RPM`, draining it first guarantees the next endpoint call is limited. Import `checkRateLimit`and`INGEST_RPM`from`src/lib/server/utils/rate-limit` in the test.

**Test harness model** — `tests/integration/simple-ingest/logs.integration.test.ts`:

- `createRequestEvent(request, db)` helper (route id `/v1/ingest`), `setupTestDatabase()`, `seedProjectWithApiKey(db)` (returns `{ ...project, apiKey }`), `clearApiKeyCache()` and `logEventBus.clear()` in `beforeEach`.
- Imports `POST` from the route and `validateApiKey`/`clearApiKeyCache` from api-key utils.
- The OTLP equivalent is `tests/integration/otlp/logs.integration.test.ts` (route id `/v1/logs`).

## Commands you will need

| Purpose                 | Command                                     | Expected |
| ----------------------- | ------------------------------------------- | -------- |
| Run simple-ingest tests | `bun run test:integration -- simple-ingest` | pass     |
| Run OTLP tests          | `bun run test:integration -- otlp`          | pass     |
| Full integration        | `bun run test:integration`                  | pass     |
| Typecheck               | `bun run check`                             | exit 0   |
| Lint                    | `vp check`                                  | exit 0   |

## Scope

**In scope** (the only files you should modify):

- `tests/integration/simple-ingest/logs.integration.test.ts` — add a rate-limit `describe`
- `tests/integration/otlp/logs.integration.test.ts` — add a rate-limit `describe`

**Out of scope** (do NOT touch):

- Any source file. This is a tests-only plan. Do NOT fix the 429 body-shape inconsistency between the two endpoints (recorded as a minor item in `plans/README.md`) — assert each endpoint's actual current response.
- `rate-limit.ts` — do not add a reset helper unless STEP 1 proves the drain approach unworkable (see STOP conditions).

## Git workflow

- Branch: `advisor/010-ingest-ratelimit-tests`
- Commit message: `test(ingest): assert 429 rate-limit wiring on /v1/ingest and /v1/logs`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Verify the drain approach works for the simple ingest endpoint

In `tests/integration/simple-ingest/logs.integration.test.ts`, add a new `describe("Rate limiting", ...)`. In a test:

1. Seed a project: `const project = await seedProjectWithApiKey(db);`
2. Import `checkRateLimit, INGEST_RPM` from `../../../src/lib/server/utils/rate-limit`.
3. Drain the bucket: loop `while (checkRateLimit(\`ingest:${project.id}\`, INGEST_RPM)) {}` until it returns false (this consumes the project's tokens directly).
4. Send a valid ingest request with `Authorization: Bearer ${project.apiKey}` and a valid single log body.
5. Assert: `response.status === 429`, `response.headers.get("Retry-After") === "60"`, and the JSON body has `error === "rate_limited"`.
6. Assert no rows were written: `const rows = await db.select().from(log).where(eq(log.projectId, project.id)); expect(rows.length).toBe(0);` (import `log` and `eq`).

Because `beforeEach` does not reset the rate-limit bucket map, add an `afterEach`/`beforeEach` that drains or accounts for cross-test bucket state — simplest is to use a FRESH project per test (new `projectId` = new bucket key), which the seed helper already does.

**Verify**: `bun run test:integration -- simple-ingest` → new test passes. If the drain loop never terminates or the endpoint still returns 200, see STOP conditions.

### Step 2: Assert per-key isolation (simple ingest)

Add a second test: seed TWO projects (A and B), drain A's bucket, then send a valid request authenticated as B and assert it succeeds (status 200, log written). This proves the limit is keyed per project, not global.

**Verify**: `bun run test:integration -- simple-ingest` → passes.

### Step 3: Mirror both tests for the OTLP endpoint

In `tests/integration/otlp/logs.integration.test.ts`, add the same `describe("Rate limiting", ...)` with the drain-then-429 test and the per-key isolation test, using the OTLP request body shape that the existing tests in that file use (an OTLP `resourceLogs` payload). Assert the OTLP endpoint's actual 429 response shape: status 429, `Retry-After: 60`, body `error === "rate_limited"` (note: the OTLP endpoint body does NOT include a `message` field — assert only what it returns).

**Verify**: `bun run test:integration -- otlp` → passes.

### Step 4: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → all pass (no cross-test bucket bleed).

## Test plan

New cases:

- `/v1/ingest`: drained bucket → 429 + `Retry-After: 60` + `error: rate_limited`; no logs written; different key unaffected.
- `/v1/logs`: same, with OTLP payload and that endpoint's response shape.
- Each test uses a fresh seeded project so the module-level bucket map doesn't bleed between tests.
- Model: existing auth/validation cases in the same two files; use `seedProjectWithApiKey`, `createRequestEvent`, and the route `POST` import already present.
- Do NOT normalize the divergent 429 body shapes here; assert each endpoint's actual current shape. The normalization nit is recorded in `plans/README.md` → "Minor items, not separately planned".

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "429\|rate_limited\|Retry-After" tests/integration/simple-ingest tests/integration/otlp` shows the new assertions
- [ ] `/v1/ingest` test asserts 429, `Retry-After: 60`, `error: rate_limited`, AND zero logs written
- [ ] `/v1/logs` test asserts the OTLP endpoint's actual 429 shape
- [ ] Both files include a per-key isolation test (drained key A limited, key B allowed)
- [ ] `bun run test:integration` passes with no cross-test bucket bleed (run twice to confirm determinism)
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] Only the two test files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Draining via `checkRateLimit(...)` in a loop does not make the endpoint return 429 (the endpoint may use a different bucket key than `ingest:${projectId}` — re-read the route and use the exact key).
- The drain loop appears infinite (capacity math means it should return false within `INGEST_RPM` iterations; if not, the limiter changed — report).
- Achieving determinism requires resetting the bucket map and no mechanism exists — report; a minimal `__resetRateLimitForTests()` export may be justified, but do not add it without flagging (it's a source change beyond this plan's scope).
- The rate-limit check in either route does not match the "Current state" excerpt.

## Maintenance notes

- For the reviewer: confirm the tests use a fresh project per case (fresh bucket key) so they're order-independent, and that the "no rows written" assertion is present for the simple endpoint.
- These tests pin behavior, not implementation. If a future change moves rate limiting into a hook or shared handler (e.g. the ingest dedup in plan 012), these tests should still pass — if they don't, the wiring genuinely changed and the tests are doing their job.
- The 429 body-shape inconsistency between the two endpoints is intentionally left as a recorded minor item (see `plans/README.md`); these tests assert the current (divergent) shapes. If that nit is ever addressed, it must update these assertions deliberately.
