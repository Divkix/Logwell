# Plan 012: Batch the incident upsert and narrow the log `.returning()` on the ingest hot path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/lib/server/utils/incidents.ts src/routes/v1/ingest/+server.ts src/routes/v1/logs/+server.ts src/lib/server/db/schema.ts` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/010-test-ingest-rate-limit-429.md and plans/011-test-incidents-sse-stream.md recommended first (regression net for the hot path). The existing `tests/integration/utils/incidents.upsert.integration.test.ts` already guards the upsert semantics.
- **Category**: perf
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

Two inefficiencies sit on the hottest write path (log ingestion), both inside or around the ingest transaction:

1. **N+1 incident upsert**: `upsertIncidentsForPreparedLogs` issues one `INSERT … ON CONFLICT DO UPDATE … RETURNING` **per distinct fingerprint**, awaited sequentially, while holding the ingest transaction open. A batch of up to 100 logs with many distinct error fingerprints means up to 100 sequential round-trips and a long-held transaction.
2. **Over-fetching `.returning()`**: `tx.insert(log).values(...).returning()` returns `RETURNING *`, which includes the large generated `search` tsvector (never used by anyone) plus full `body`/`metadata`/`resourceAttributes`/`scopeAttributes` JSONB — for up to 100 rows — and then ships those full rows to every connected SSE client via `JSON.stringify`.

Logs are already pre-grouped by fingerprint (each fingerprint is unique in the aggregate list), so the upsert can be a single multi-row statement. And the SSE stream only renders a subset of columns, so the returned projection can exclude the heavy ones.

## Current state

**N+1 loop** — `src/lib/server/utils/incidents.ts`, `upsertIncidentsForPreparedLogs` (around lines 170–230). `aggregates` comes from `groupPreparedLogsByFingerprint(logs)` so **each fingerprint appears exactly once**:

```ts
const aggregates = groupPreparedLogsByFingerprint(logs);
...
for (const aggregate of aggregates) {
  const now = new Date();
  const [result] = await db
    .insert(incident)
    .values({ id: nanoid(), projectId, fingerprint: aggregate.fingerprint, /* ... */, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [incident.projectId, incident.fingerprint],
      set: {
        highestLevel: sql`( CASE WHEN ${incident.highestLevel}::text = 'fatal' OR excluded.highest_level::text = 'fatal' THEN 'fatal' ELSE 'error' END )::log_level`,
        firstSeen: sql`LEAST(${incident.firstSeen}, excluded.first_seen)`,
        lastSeen: sql`GREATEST(${incident.lastSeen}, excluded.last_seen)`,
        totalEvents: sql`${incident.totalEvents} + excluded.total_events`,
        updatedAt: now,
      },
    })
    .returning();
  if (!result) throw new Error(`Incident upsert returned no row for fingerprint: ${aggregate.fingerprint}`);
  incidentByFingerprint.set(aggregate.fingerprint, result);
  touchedIncidents.push(result);
}
```

**Over-fetching returning** — `src/routes/v1/ingest/+server.ts` (around line 176) and `src/routes/v1/logs/+server.ts` (around line 171):

```ts
const insertedLogs = await tx.insert(log).values(logEntries).returning(); // RETURNING *
return { insertedLogs, touchedIncidents };
```

Then both files emit each row to the bus:

```ts
for (const insertedLog of insertedLogs) {
  logEventBus.emitLog(insertedLog);
}
```

**The generated column** — `src/lib/server/db/schema.ts:122-129` defines `search` as a `tsvector generatedAlwaysAs(...)`. It is a selectable column on the `Log` type, which is why `.returning()` (no args) pulls it.

**What the SSE consumer actually uses**: the logs/stream serializes the whole `Log[]` via `JSON.stringify(batch)`. The log-viewer UI renders message/level/timestamp/service/metadata/source — NOT the `search` vector. The safest narrowing is to exclude `search` (definitely unused) while keeping every other column the SSE payload currently carries, so the stream contract is unchanged except for dropping `search`.

**Existing regression tests**: `tests/integration/utils/incidents.upsert.integration.test.ts` covers concurrent upserts for the same and different fingerprints, asserting `totalEvents` accumulation and `lastSeen` = GREATEST. These MUST still pass after batching.

## Commands you will need

| Purpose               | Command                                                   | Expected |
| --------------------- | --------------------------------------------------------- | -------- |
| Incident upsert tests | `bun run test:integration -- incidents`                   | pass     |
| Ingest tests          | `bun run test:integration -- simple-ingest` and `-- otlp` | pass     |
| Stream tests          | `bun run test:integration -- stream`                      | pass     |
| Typecheck             | `bun run check`                                           | exit 0   |
| Lint                  | `vp check`                                                | exit 0   |
| Full integration      | `bun run test:integration`                                | pass     |

## Scope

**In scope** (the only files you should modify):

- `src/lib/server/utils/incidents.ts` — replace the per-fingerprint loop with one multi-row upsert
- `src/routes/v1/ingest/+server.ts` — narrow `.returning(...)` to exclude `search`
- `src/routes/v1/logs/+server.ts` — narrow `.returning(...)` to exclude `search`
- (optional) `tests/integration/utils/incidents.upsert.integration.test.ts` — add a multi-fingerprint single-batch case

**Out of scope** (do NOT touch):

- The transaction boundaries in the route files (keep the `db.transaction(async (tx) => {...})` shape).
- The incident upsert's SET semantics (the `excluded.*` / LEAST / GREATEST / sum logic must be preserved exactly).
- The SSE stream files and the event bus — the emit loop stays; only the returned column set changes.
- The `search` tsvector definition in `schema.ts` — that's plan 014.
- The rate-limit / api-key / re-verify logic.

## Git workflow

- Branch: `advisor/012-batch-incident-upsert`
- Commit message: `perf(ingest): batch incident upsert and drop tsvector from returning`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Convert the upsert loop to a single multi-row statement

In `upsertIncidentsForPreparedLogs`, replace the `for (const aggregate of aggregates)` loop with ONE insert of all aggregates. Because `groupPreparedLogsByFingerprint` guarantees each fingerprint is unique within `aggregates`, there is no "ON CONFLICT cannot affect row a second time" risk within the batch.

Target shape:

```ts
const now = new Date();
const rows = await db
  .insert(incident)
  .values(
    aggregates.map((aggregate) => ({
      id: nanoid(),
      projectId,
      fingerprint: aggregate.fingerprint,
      title: aggregate.title,
      normalizedMessage: aggregate.normalizedMessage,
      serviceName: aggregate.serviceName,
      sourceFile: aggregate.sourceFile,
      lineNumber: aggregate.lineNumber,
      highestLevel: aggregate.highestLevel,
      firstSeen: aggregate.firstSeen,
      lastSeen: aggregate.lastSeen,
      totalEvents: aggregate.totalEvents,
      createdAt: now,
      updatedAt: now,
    })),
  )
  .onConflictDoUpdate({
    target: [incident.projectId, incident.fingerprint],
    set: {
      highestLevel: sql`( CASE WHEN ${incident.highestLevel}::text = 'fatal' OR excluded.highest_level::text = 'fatal' THEN 'fatal' ELSE 'error' END )::log_level`,
      firstSeen: sql`LEAST(${incident.firstSeen}, excluded.first_seen)`,
      lastSeen: sql`GREATEST(${incident.lastSeen}, excluded.last_seen)`,
      totalEvents: sql`${incident.totalEvents} + excluded.total_events`,
      updatedAt: now,
    },
  })
  .returning();

for (const row of rows) {
  incidentByFingerprint.set(row.fingerprint, row);
  touchedIncidents.push(row);
}
```

Keep the early `if (aggregates.length === 0) return {...}` guard. Remove the per-row `if (!result) throw` (replaced by mapping over `rows`); if `rows.length !== aggregates.length` you may add a single sanity check, but RETURNING from an upsert returns one row per inserted-or-updated row, so they should match.

**Verify**: `bun run check` → exit 0.

### Step 2: Confirm the upsert semantics are preserved by the existing tests

Run the existing incident upsert + integration tests. The concurrent-upsert race tests and the `incidents.integration.test.ts` must pass unchanged — they assert `totalEvents` accumulation, `lastSeen` = GREATEST, fatal escalation.

**Verify**: `bun run test:integration -- incidents` → all pass. If the multi-row `excluded` references don't resolve in PGlite or Postgres, see STOP conditions.

### Step 3: Add a multi-fingerprint single-batch test

In `tests/integration/utils/incidents.upsert.integration.test.ts`, add a test that calls `upsertIncidentsForPreparedLogs` ONCE with a `PreparedIncidentLog[]` containing several DISTINCT fingerprints plus repeats of some, and asserts: the correct number of incident rows created, each `totalEvents` equals its occurrence count, and `incidentByFingerprint` has an entry per distinct fingerprint. This directly exercises the new batched path.

**Verify**: `bun run test:integration -- incidents` → new test passes.

### Step 4: Narrow `.returning()` in both ingest routes

In `src/routes/v1/ingest/+server.ts` and `src/routes/v1/logs/+server.ts`, change `.returning()` to an explicit column projection that includes every `log` column EXCEPT `search`. The cleanest approach: build a shared column object once. Add to `src/lib/server/db/schema.ts` or a small helper a constant listing the streamed columns, OR inline the projection. Minimal inline version:

```ts
const insertedLogs = await tx.insert(log).values(logEntries).returning({
  id: log.id,
  projectId: log.projectId,
  incidentId: log.incidentId,
  fingerprint: log.fingerprint,
  serviceName: log.serviceName,
  level: log.level,
  message: log.message,
  metadata: log.metadata,
  timeUnixNano: log.timeUnixNano,
  observedTimeUnixNano: log.observedTimeUnixNano,
  severityNumber: log.severityNumber,
  severityText: log.severityText,
  body: log.body,
  droppedAttributesCount: log.droppedAttributesCount,
  flags: log.flags,
  traceId: log.traceId,
  spanId: log.spanId,
  resourceAttributes: log.resourceAttributes,
  resourceDroppedAttributesCount: log.resourceDroppedAttributesCount,
  resourceSchemaUrl: log.resourceSchemaUrl,
  scopeName: log.scopeName,
  scopeVersion: log.scopeVersion,
  scopeAttributes: log.scopeAttributes,
  scopeDroppedAttributesCount: log.scopeDroppedAttributesCount,
  scopeSchemaUrl: log.scopeSchemaUrl,
  sourceFile: log.sourceFile,
  lineNumber: log.lineNumber,
  requestId: log.requestId,
  userId: log.userId,
  ipAddress: log.ipAddress,
  timestamp: log.timestamp,
});
```

This is every column minus `search`. `logEventBus.emitLog` expects a `Log`; verify the emit/SSE code does not read `insertedLog.search` (it does not — the UI never renders it). If TypeScript complains that the narrowed shape isn't assignable to `Log`, see Step 5.

**Verify**: `bun run check` → exit 0 OR a type mismatch surfaces (handle in Step 5).

### Step 5: Reconcile the emit type if needed

`logEventBus.emitLog(log: Log)` requires a full `Log`. The narrowed `.returning(...)` produces `Log` minus `search`. Options, in order of preference:

- If `search` is the only missing field and nothing downstream reads it, change the event bus `LogListener`/`emitLog` to accept `Omit<Log, "search">` (define a `StreamLog = Omit<Log, "search">` type in `events.ts` or `schema.ts` and use it in `emitLog`, `onLog`, and the SSE handler types). This is a small, type-safe ripple.
- Do NOT cast with `as Log` to paper over it — that reintroduces the risk of someone reading the absent column.

Apply the `Omit<Log, "search">` typing through `events.ts` and the two SSE stream handler signatures (`handleLog`). The stream's `JSON.stringify(batch)` is unaffected.

**Verify**: `bun run check` → exit 0; `bun run test:integration -- stream` → pass.

### Step 6: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → all pass (incidents, ingest, stream).

## Test plan

- New: single-batch multi-fingerprint upsert test (Step 3) exercising the batched statement.
- Preserved: existing concurrent-upsert race tests, incident integration tests, ingest integration tests, stream tests — all must pass unchanged.
- If you add the `Omit<Log, "search">` typing, the stream tests confirm SSE delivery still works with the narrowed shape.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `upsertIncidentsForPreparedLogs` issues a single `.insert(incident).values([...]).onConflictDoUpdate(...).returning()` (no per-aggregate loop with `await` inside)
- [ ] The upsert SET semantics (LEAST/GREATEST/sum/fatal-escalation) are byte-for-byte preserved
- [ ] Both ingest routes use `.returning({...})` WITHOUT `search`
- [ ] `grep -n "\.returning()" src/routes/v1/ingest/+server.ts src/routes/v1/logs/+server.ts` returns no bare `.returning()` for the log insert
- [ ] New multi-fingerprint single-batch test passes
- [ ] `bun run test:integration` passes (incidents, ingest, stream all green)
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] Only the in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `upsertIncidentsForPreparedLogs` or the ingest `.returning()` do not match the "Current state" excerpts.
- The multi-row `onConflictDoUpdate` with `excluded.*` references fails to compile or run under PGlite or Postgres (Drizzle multi-row upsert + `excluded` should work, but if it errors, report the exact message — do NOT fall back to the loop silently).
- A concurrent-upsert race test starts failing after batching (the atomicity guarantee changed — report; the per-row upsert was relied upon).
- Narrowing `.returning()` breaks a consumer that reads `search` (grep `\.search` across `src/` to confirm none do before starting).
- `groupPreparedLogsByFingerprint` is found NOT to dedupe fingerprints (then a single fingerprint could appear twice in `values()` and the upsert would error — verify the grouping first).

## Maintenance notes

- For the reviewer: the highest-risk part is the multi-row upsert preserving exact accumulation semantics. Scrutinize the SET clause and the race-condition tests.
- Future: if `BATCH_INSERT_LIMIT` is raised well beyond 100, the single multi-row upsert remains O(1) round-trips — good. The narrowed returning also caps SSE payload growth.
- The `search` tsvector write cost on insert is a separate concern (plan 014); this plan only stops reading it back.
- If a future SSE feature needs a column not in the narrowed projection, add it to the `.returning({...})` set and the `StreamLog` type together.
