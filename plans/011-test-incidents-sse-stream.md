# Plan 011: Add integration tests for the incidents SSE stream (currently zero coverage)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/api/projects/'[id]'/incidents/stream/+server.ts src/routes/api/projects/'[id]'/logs/stream/+server.ts` — if either changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (recommended to land before plan 006, which fixes a bug in both stream files)
- **Category**: tests
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

The incidents SSE stream (`POST /api/projects/[id]/incidents/stream`) is a near-twin of the log stream — same auth, CSRF, batching, heartbeat, backpressure, and cleanup machinery — but has **zero tests**, while the log stream has a thorough suite. It's an authenticated, ownership-gated, real-time data path. Without tests there's no regression net for: unauthenticated 401, cross-tenant 404, CSRF 403, incident delivery, project isolation, or listener cleanup on disconnect (an event-bus leak if it regresses). This is also a prerequisite safety net for plan 006, which modifies the backpressure logic in this exact file.

## Current state

**`src/routes/api/projects/[id]/incidents/stream/+server.ts`** — the endpoint:

- `POST` handler: `checkCsrfOrigin(event)` → `requireProjectOwnership(event, event.params.id)` → returns a `ReadableStream` SSE response.
- Subscribes via `logEventBus.onIncident(projectId, handleIncident)`; emits `event: incidents` with a JSON array batch; sends `event: heartbeat`.
- Cleanup unsubscribes and clears timers on `cancel()` / closed controller.
- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.

**The event bus** — `src/lib/server/events.ts`:

- `logEventBus.emitIncident(incident)` delivers to project subscribers.
- `logEventBus.getIncidentListenerCount(projectId)` returns the active incident-listener count (use for the cleanup assertion).
- `logEventBus.clear()` resets all listeners (call in `beforeEach`/`afterEach`).

**The model to copy** — `tests/integration/api/projects/[id]/logs/stream/server.integration.test.ts` is a complete, working example with all the helpers you need:

- `createRequestEvent(request, db, params, authenticated)` — builds the mock SvelteKit event (note: it sets `route.id` to the logs/stream route; for the new file set it to `/api/projects/[id]/incidents/stream`).
- `parseSSEStream(response)` and `collectSSEEvents(response, count, timeoutMs)` — SSE parsing helpers.
- `setupTestDatabase()`, `seedProject(db, { ownerId })`, `logEventBus.clear()`, creating the test user.
- It uses real timers with `setTimeout` sleeps (50ms setup, generous collect windows) — replicate this to avoid flakiness.

**Incident shape**: import `Incident` type from schema. You'll need a `createMockIncident(projectId, overrides)` helper analogous to the log stream's `createMockLog`. An `Incident` has fields: `id`, `projectId`, `fingerprint`, `title`, `normalizedMessage`, `serviceName`, `sourceFile`, `lineNumber`, `highestLevel`, `firstSeen`, `lastSeen`, `totalEvents`, `createdAt`, `updatedAt` (see `src/lib/server/db/schema.ts` `incident` table for exact columns). Build a minimal valid object.

## Commands you will need

| Purpose              | Command                                        | Expected |
| -------------------- | ---------------------------------------------- | -------- |
| Run the new test     | `bun run test:integration -- incidents/stream` | pass     |
| Run all stream tests | `bun run test:integration -- stream`           | pass     |
| Full integration     | `bun run test:integration`                     | pass     |
| Typecheck            | `bun run check`                                | exit 0   |
| Lint                 | `vp check`                                     | exit 0   |

## Scope

**In scope** (the only file you should create):

- `tests/integration/api/projects/[id]/incidents/stream/server.integration.test.ts` (create)

**Out of scope** (do NOT touch):

- The endpoint source (`incidents/stream/+server.ts`) — this plan only ADDS tests. If a test reveals a bug, report it (plan 006 fixes the backpressure issue separately).
- The log stream test file — copy from it, don't modify it.
- `events.ts` — use its existing public methods.

## Git workflow

- Branch: `advisor/011-incidents-stream-tests`
- Commit message: `test(sse): add integration coverage for the incidents stream endpoint`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Scaffold the test file from the log stream test

Create `tests/integration/api/projects/[id]/incidents/stream/server.integration.test.ts`. Copy the structure of the logs/stream test: the imports, `createRequestEvent` (change `route.id` to `/api/projects/[id]/incidents/stream`), `parseSSEStream`, `collectSSEEvents`, the `beforeEach`/`afterEach` (setup db, `logEventBus.clear()`, create test user), and adapt `createMockLog` into `createMockIncident`.

Import `POST` dynamically inside each test as the log stream test does:

```ts
const { POST } =
  await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");
```

(Verify the relative depth matches the new file's location — count the directories; it should mirror the logs/stream path which is at the same depth.)

**Verify**: `bun run check` → exit 0 (file typechecks even before tests run).

### Step 2: Authentication & authorization tests

Add a `describe("Authentication & Authorization")` with:

- **401 unauthenticated**: `createRequestEvent(..., false)`; `await POST(event)` should throw with `status: 401` (the log stream test catches the thrown error — mirror that try/catch).
- **404 cross-tenant**: seed a project owned by a DIFFERENT user (`seedProject(db, { ownerId: otherUserId })`), call as the test user, expect `response.status === 404` and body `error === "not_found"`. (Create a second user row for `otherUserId`.) This is the IDOR guard assertion — important: assert 404 for an EXISTING-but-not-owned project, not just a non-existent id.

**Verify**: `bun run test:integration -- incidents/stream` → these pass.

### Step 3: CSRF test

Add a `describe("CSRF")`: send a POST with a mismatched `Origin` header (`Origin: https://evil.com`) and assert `response.status === 403` with body `error === "csrf_error"`. (The endpoint calls `checkCsrfOrigin` first.) Build the request with the bad Origin header in the `Request` constructor.

**Verify**: passes.

### Step 4: Streaming + isolation tests

Add a `describe("Incident streaming")`:

- **Delivers incidents**: open the stream (authenticated, owned project), wait ~50ms for subscription, `logEventBus.emitIncident(createMockIncident(project.id, { title: "Test incident" }))`, collect events, assert an `incidents` event arrives whose parsed array contains the emitted incident.
- **Project isolation**: emit an incident for a DIFFERENT project and one for the subscribed project; assert only the subscribed project's incident is received.

**Verify**: passes.

### Step 5: Response format + cleanup tests

- **SSE headers**: assert `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, status 200.
- **Cleanup on disconnect**: assert `logEventBus.getIncidentListenerCount(project.id)` is 0 before, 1 after opening (wait ~50ms), then `await reader.cancel()`, wait ~100ms, and assert it returns to 0. (Mirror the log stream's cleanup test but use `getIncidentListenerCount`.)

**Verify**: `bun run test:integration -- incidents/stream` → all pass.

### Step 6: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → all pass.

## Test plan

New file mirroring the logs/stream suite, covering for the incidents stream:

- 401 unauthenticated, 404 cross-tenant (owned by another user), 403 CSRF mismatch.
- Incident delivery via `emitIncident`, project isolation.
- SSE headers, listener cleanup to 0 after `cancel()`.
- Real timers with generous waits (50ms setup, ≥3000ms collect) to match the existing suite's flakiness profile.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `tests/integration/api/projects/[id]/incidents/stream/server.integration.test.ts` exists
- [ ] It covers: 401 unauth, 404 cross-tenant (existing-but-not-owned), 403 CSRF, incident delivery, project isolation, SSE headers, cleanup-to-0
- [ ] `bun run test:integration -- incidents/stream` passes
- [ ] `bun run test:integration` passes (no regressions, no listener bleed across tests)
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] Only the new test file is added (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The endpoint source does not match the "Current state" description (different auth/CSRF/event-bus method names).
- A test reveals an actual bug in the endpoint (e.g. cleanup doesn't return the count to 0, or backpressure drops incidents). Document it — do NOT fix the endpoint here; note that plan 006 addresses the backpressure drop. A failing cleanup test that reflects a real leak should be reported, not deleted.
- The relative `import("...")` path depth is wrong and the route can't be imported — recount directories and report if it can't be resolved.
- `getIncidentListenerCount` does not exist on the event bus (use the actual method name from `events.ts`).

## Maintenance notes

- For the reviewer: confirm the cross-tenant test seeds an EXISTING project owned by another user (true IDOR check), not merely a missing id.
- This suite becomes the regression net for plan 006 (SSE backpressure fix), which edits this same endpoint — land this first if sequencing allows.
- If plan 015 later extracts a shared SSE-stream factory, these tests should continue to pass unchanged — they assert behavior, not structure.
