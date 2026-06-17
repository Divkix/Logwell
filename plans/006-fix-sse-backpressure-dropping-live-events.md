# Plan 006: Stop SSE streams from silently dropping live events on bursts >50 logs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/api/projects/'[id]'/logs/stream/+server.ts src/routes/api/projects/'[id]'/incidents/stream/+server.ts src/routes/v1/ingest/+server.ts src/routes/v1/logs/+server.ts` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/011-test-incidents-sse-stream.md is recommended to land first (gives a regression net), but not strictly required
- **Category**: bug
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

Real-time log streaming is a headline feature, and it silently loses data. A default `ReadableStream` has `highWaterMark = 1`, so `controller.desiredSize` becomes `0` immediately after the first `enqueue()` and stays `≤ 0` until the consumer pulls (asynchronously). The SSE code treats `desiredSize <= 0` as "backpressure" and **drops the batch**. On the ingest path, logs are emitted to the bus in a **synchronous** loop, so a single ingest of 51–100 logs (allowed up to `BATCH_INSERT_LIMIT = 100`) flushes the first batch (≤50), drives `desiredSize` to 0, and then every subsequent flush in that synchronous burst is dropped. Result: connected live viewers lose everything after the first ~50 logs of any large batch, and heartbeats can be suppressed during the window. This makes "real-time streaming" lossy exactly when there's the most to show.

## Current state

Both SSE endpoints share identical `sendEvent` logic. The bug is the `<= 0` comparison combined with a `highWaterMark = 1` stream.

**`src/routes/api/projects/[id]/logs/stream/+server.ts`** — `sendEvent` (around lines 60–75):

```ts
const sendEvent = (eventName: string, data: string): "sent" | "backpressure" | "closed" => {
  if (isClosed) return "closed";
  try {
    const size = (controller as ReadableStreamDefaultController).desiredSize;
    if (size !== null && size <= 0) {
      // Stream backpressure: slow consumer, drop the event but keep the stream alive
      console.debug("[logs/stream] backpressure detected, dropping batch");
      return "backpressure";
    }
    controller.enqueue(encoder.encode(formatSSEEvent(eventName, data)));
    return "sent";
  } catch {
    return "closed";
  }
};
```

The stream is created with `new ReadableStream({ start(controller) {...}, cancel() {...} })` — **no queuing strategy**, so `highWaterMark` defaults to `1`.

**`src/routes/api/projects/[id]/incidents/stream/+server.ts`** — same `sendEvent` (around lines 38–52), same default-`highWaterMark` stream.

**The synchronous emit loop** that triggers it — `src/routes/v1/ingest/+server.ts` (around lines 178–185):

```ts
// Emit to event bus for real-time streaming
for (const insertedLog of insertedLogs) {
  logEventBus.emitLog(insertedLog);
}
for (const touchedIncident of touchedIncidents) {
  logEventBus.emitIncident(touchedIncident);
}
```

Identical loop in `src/routes/v1/logs/+server.ts` (around lines 172–177). Each `emitLog` synchronously calls every subscribed stream's `handleLog`, which pushes to `batch` and flushes when `batch.length >= MAX_BATCH_SIZE` (50) — all within the synchronous ingest request, before the consumer can pull.

**Config**: `SSE_CONFIG.MAX_BATCH_SIZE` default 50, `API_CONFIG.BATCH_INSERT_LIMIT` 100 (`src/lib/server/config/performance.ts`).

## The fix (two complementary changes)

1. **Raise the stream's `highWaterMark`** so a normal post-enqueue state isn't mistaken for a stalled consumer. Use a `CountQueuingStrategy` with a buffer comfortably above `MAX_BATCH_SIZE`-driven bursts.
2. **Correct the backpressure threshold** so it only treats a genuinely negative `desiredSize` (queue over the high-water mark) as backpressure, not the normal `0` resting state.

Both are needed: (1) gives headroom for a 100-log burst; (2) makes the resting state (`desiredSize === 0`) not drop events.

There is an alternative (coalesce ingest into one array-emit per batch), but it changes the event-bus contract and both SSE consumers — out of scope here. This plan keeps the per-log emit and fixes the stream side, which is the minimal correct fix.

## Commands you will need

| Purpose              | Command                                   | Expected        |
| -------------------- | ----------------------------------------- | --------------- |
| Typecheck            | `bun run check`                           | exit 0          |
| Lint                 | `vp check`                                | exit 0          |
| Existing stream test | `bun run test:integration -- logs/stream` | pass            |
| New burst test       | `bun run test:integration -- logs/stream` | new test passes |
| Full integration     | `bun run test:integration`                | pass            |

## Scope

**In scope** (the only files you should modify):

- `src/routes/api/projects/[id]/logs/stream/+server.ts` — fix `sendEvent` threshold + stream `highWaterMark`
- `src/routes/api/projects/[id]/incidents/stream/+server.ts` — same fix (keep the two in sync)
- `tests/integration/api/projects/[id]/logs/stream/server.integration.test.ts` — add a burst regression test

**Out of scope** (do NOT touch):

- The ingest endpoints (`v1/ingest`, `v1/logs`) — do not change the emit loop in this plan.
- `src/lib/server/events.ts` — the event bus contract stays.
- The SSE batching window / `MAX_BATCH_SIZE` defaults in `performance.ts`.
- Do NOT refactor the two stream files into a shared factory here (that's a separate tech-debt plan) — fix both in place so the change is reviewable and low-risk.

## Git workflow

- Branch: `advisor/006-sse-backpressure-fix`
- Commit message: `fix(sse): stop dropping live events on bursts above the batch size`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a high-water mark to both streams

In each stream file, change the stream construction to pass a `CountQueuingStrategy`. The stream is currently `new ReadableStream({ start(controller) {...}, cancel() {...} })`. Add a second argument:

```ts
const stream = new ReadableStream(
  {
    start(controller) {
      /* unchanged */
    },
    cancel() {
      /* unchanged */
    },
  },
  new CountQueuingStrategy({ highWaterMark: 256 }),
);
```

`256` gives ample headroom over a 100-log ingest burst plus heartbeats, while still bounding memory for a truly stalled consumer (each queued chunk is one SSE frame). Apply to BOTH `logs/stream` and `incidents/stream`.

**Verify**: `bun run check` → exit 0.

### Step 2: Correct the backpressure threshold in `sendEvent`

In BOTH stream files, change the backpressure condition from `size <= 0` to `size < 0`. With the higher `highWaterMark`, `desiredSize` only goes negative when the internal queue exceeds the high-water mark (a real slow consumer); the normal resting `0` no longer drops events.

Logs stream:

```ts
if (size !== null && size < 0) {
  console.debug("[logs/stream] backpressure detected, dropping batch");
  return "backpressure";
}
```

Incidents stream (same change, its comment is shorter — preserve its existing comment text, just change `<= 0` to `< 0`).

**Verify**: `grep -n "size <= 0\|size < 0" src/routes/api/projects/'[id]'/logs/stream/+server.ts src/routes/api/projects/'[id]'/incidents/stream/+server.ts` → both files show `size < 0`, neither shows `<= 0`.

### Step 3: Add a burst regression test

In `tests/integration/api/projects/[id]/logs/stream/server.integration.test.ts`, add a test under a new or existing `describe`. Model it on the existing "flushes immediately when batch reaches 50 logs" test (same file). The new test emits a burst LARGER than `MAX_BATCH_SIZE` (e.g. 100 logs) synchronously and asserts that **all 100** are received across the collected `logs` events — proving none are dropped.

Key structure (adapt to the file's existing helpers `createRequestEvent`, `collectSSEEvents`, `createMockLog`, `seedProject`):

```ts
it("delivers all logs when a burst exceeds the batch size", async () => {
  const project = await seedProject(db, { ownerId: userId });
  const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
    method: "POST",
  });
  const event = createRequestEvent(request, db, { id: project.id }, true);
  const { POST } =
    await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
  const response = await POST(event as never);

  await new Promise((r) => setTimeout(r, 50)); // let subscription set up

  const TOTAL = 100;
  for (let i = 0; i < TOTAL; i++) {
    logEventBus.emitLog(createMockLog(project.id, { message: `burst ${i}` }));
  }

  // Collect enough events to cover all batches (first flush is 50, remainder follow)
  const events = await collectSSEEvents(response, 5, 3000);
  const received = events
    .filter((e) => e.event === "logs")
    .flatMap((e) => JSON.parse(e.data) as Log[]);

  expect(received.length).toBe(TOTAL);
});
```

If `collectSSEEvents`'s `count` parameter stops early, raise it or collect by total-logs; the assertion that matters is `received.length === 100`.

**Verify (fails before fix, passes after)**: temporarily stash your Step 1–2 changes (`git stash`), run the new test → it should FAIL (receives ~50). Restore (`git stash pop`), run again → PASSES (receives 100). This proves the test actually guards the bug. If you cannot easily stash, at least confirm the test passes WITH the fix.

### Step 4: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → all pass (existing stream tests + new burst test).

## Test plan

- New test: "delivers all logs when a burst exceeds the batch size" in the logs/stream integration suite — emits 100 logs synchronously, asserts all 100 received.
- Model: the existing "flushes immediately when batch reaches 50 logs" test in the same file.
- Regression intent: this test must fail against the pre-fix `<= 0` + `highWaterMark=1` code and pass after.
- Existing tests (auth 401/404, isolation, batching, cleanup) must still pass unchanged.
- Note: the suite uses real timers and `setTimeout` sleeps — keep the new test's waits generous (3000ms collect window) to avoid flakiness.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Both stream files construct `ReadableStream` with a `CountQueuingStrategy({ highWaterMark: 256 })`
- [ ] `grep -rn "size <= 0" src/routes/api/projects/'[id]'/*/stream/+server.ts` returns no matches
- [ ] New burst test exists in the logs/stream integration file and passes
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] `bun run test:integration` passes (all stream tests green)
- [ ] Only the two stream files and the one test file are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `sendEvent` code does not match the "Current state" excerpt (e.g. it already uses `< 0` or a queuing strategy is already present) — the bug may be partially fixed; report what you find.
- The new burst test still drops events after both changes (something else — perhaps the consumer-pull timing in the test harness — is at play; report the observed count).
- Applying the `highWaterMark` causes existing batching tests to fail (the batch-size flush behavior must be preserved; if it breaks, report rather than weakening assertions).
- You discover the ingest emit loop has been changed to emit arrays (then this stream-side fix may be unnecessary — report).

## Maintenance notes

- For the reviewer: confirm the two stream files stay behaviorally identical (this codebase keeps them in lockstep). Confirm the new test genuinely fails pre-fix.
- The deeper structural fix is to coalesce the ingest emit into one array event per batch (eliminating the synchronous N-emit storm entirely) and/or extract a shared SSE-stream factory — tracked separately as a tech-debt item. This plan is the minimal correctness fix.
- If a future change raises `BATCH_INSERT_LIMIT` well above 256, revisit the `highWaterMark` headroom.
- `desiredSize < 0` still preserves genuine backpressure handling for truly stalled consumers (queue exceeds high-water mark), so slow clients still degrade gracefully rather than ballooning memory.
