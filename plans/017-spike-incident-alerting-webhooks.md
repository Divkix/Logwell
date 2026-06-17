# Plan 017 (SPIKE): Incident alerting — outbound webhooks / Slack on new incidents

> **Nature**: This is a DESIGN + SPIKE plan, not a build-everything plan. It
> exists to de-risk a direction before committing. The executor's job is to
> validate the seams, build a minimal vertical slice behind a flag, and report
> findings — NOT to ship a full alerting product. Follow the steps, then STOP
> at the "Spike exit" gate and report for a go/no-go.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/v1 src/lib/server/events.ts src/lib/server/utils/incidents.ts src/lib/server/db/schema.ts` — if any changed, re-read those files before relying on the "Current state" notes.

## Status

- **Priority**: P2 (highest-value direction — a logging tool that can't tell you when something breaks is half a tool)
- **Effort**: L (spike is M; full build is L+)
- **Risk**: MED
- **Depends on**: nothing hard. Pairs naturally with plan 006 (SSE fix) and 011 (incident-stream tests) since all touch the incident emit path. The reliability concern in "Open questions" is amplified by plan 006's findings.
- **Category**: direction / feature
- **Planned at**: commit `8ec01b0`, 2026-06-17

## The opportunity

Logwell already detects incidents (fingerprinting + upsert in `incidents.ts`) and broadcasts them in-process via `logEventBus.emitIncident(...)`. The missing half is **push**: notifying a human/channel when a NEW incident appears (or an existing one reopens / crosses a severity threshold). This is the single most impactful product gap for a self-hosted error tracker. The existing `emitIncident` seam is the obvious integration point.

## Current state (the seams you build on)

- **Emit point**: both ingest routes (`src/routes/v1/ingest/+server.ts:181`, `src/routes/v1/logs/+server.ts:177`) loop over `touchedIncidents` and call `logEventBus.emitIncident(incident)` AFTER the DB transaction commits. This is the natural hook — alerts fire only on committed incidents.
- **CRITICAL GAP — new vs. existing is not distinguished here**: `upsertIncidentsForPreparedLogs` (`incidents.ts`) returns `touchedIncidents` for BOTH newly-created and merely-updated incidents, and the emit loop fires for all of them. For alerting you almost always want "new incident" or "reopened incident", NOT "existing incident got one more event". The upsert uses `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which does NOT tell you whether a row was inserted or updated. **Resolving this is the spike's first job** (see Step 1).
- **Status is computed, not stored**: `getIncidentStatus(lastSeen)` derives open/resolved from `lastSeen` vs `INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES`. There is no `resolvedAt`/`ackedAt` column. "Reopen" is therefore also computed, not an event — another reason Step 1 matters.
- **Event bus is in-memory + singleton** (`events.ts`), single-process. Fine for SSE; for alerting, delivery should not depend on a browser being connected. Alerts must fire from the ingest/server side regardless of SSE subscribers.
- **No outbound HTTP/queue infrastructure exists yet**. There's a rate limiter (`rate-limit.ts`) and config plumbing (`$lib/server/config`) to model new env vars on.

## Design decisions to resolve in the spike (do NOT pre-decide — validate)

1. **How to detect "new" / "reopened" incidents** at the emit site (Step 1). Options to evaluate:
   - Have `upsertIncidentsForPreparedLogs` return per-incident `{ isNew: boolean; wasReopened: boolean }`. Postgres can report inserted-vs-updated via `xmax = 0` trick or `(xmax = 0) AS inserted` in RETURNING, or by checking `createdAt === updatedAt`. Validate which is reliable under the batched upsert (note plan 012 may batch this — coordinate).
   - "Reopened" = the incident existed, was in computed-`resolved` state (lastSeen older than auto-resolve), and just got a new event. Detectable by comparing the PRE-update `lastSeen` to the resolve threshold — requires reading prior state or returning it from the upsert.
2. **Delivery channel abstraction**: a minimal `Notifier` interface with a generic webhook (POST JSON) first; Slack/Discord are just specific payload shapes over the same webhook. Do NOT build a plugin framework — one webhook notifier is the slice.
3. **Where alert config lives**: per-project (a `project.alertWebhookUrl` column + optional secret) vs global env. Recommend per-project (a new nullable column) so multi-project installs work, but the SPIKE can start with a single global env webhook to prove the path, then note the schema change for the full build.
4. **Reliability**: alerts fire after commit, out of the request's critical path. Decide fire-and-forget vs. a retry/outbox. For the spike, fire-and-forget with a logged failure is acceptable; flag that at-least-once delivery (outbox table) is the real-build requirement.
5. **Anti-spam**: a noisy service can create many incidents fast. Reuse the token-bucket (`rate-limit.ts`) keyed per project to cap alert volume, OR dedupe by fingerprint within a window. Note as a real-build requirement; spike can ship without it but must flag it.

## Scope of the SPIKE (vertical slice only)

**In scope**:

- Step 1's detection mechanism (`isNew`) — this is the load-bearing change and may be the deliverable on its own.
- A single `Notifier` that POSTs a JSON incident payload to ONE webhook URL read from a new env var (global), behind a feature flag (env-gated; off by default).
- Wiring at the emit site: when `isNew` (and the flag is on), enqueue/fire the webhook AFTER commit.
- One integration test proving: a new incident triggers exactly one webhook POST with the right payload; an UPDATE to an existing incident does NOT.
- A short `docs/alerting.md` (or README section) describing the env var and payload shape.

**Explicitly OUT of scope for the spike** (defer to the full-build plan that this spike informs):

- Per-project webhook config UI + schema column.
- Slack/Discord-specific formatting beyond a generic JSON body.
- Retry/outbox/at-least-once delivery.
- Alert rules (severity thresholds, mute windows, per-service routing).
- Multiple destinations / fan-out.

## Spike steps

### Step 1: Make "new incident" detectable (the keystone)

In `incidents.ts`, extend the upsert result so each touched incident carries `isNew` (and ideally `wasReopened`). Validate the chosen mechanism with an integration test:

- New fingerprint → `isNew: true`.
- Same fingerprint again → `isNew: false`.
- Coordinate with plan 012 if it batches the upsert (the inserted-vs-updated detection must survive batching — `(xmax = 0)` in RETURNING works for multi-row upserts; validate under PGlite AND Postgres).

**Verify**: `bun run test:integration -- incidents` passes with new `isNew` assertions. If neither `xmax` nor `createdAt===updatedAt` is reliable under PGlite, document the limitation and pick the Postgres-correct one (E2E covers real PG).

**Gate**: if Step 1 can't reliably distinguish new from updated, STOP and report — alerting on every touched incident is too noisy to ship and the whole direction needs rethinking.

### Step 2: Minimal webhook notifier behind a flag

Add `src/lib/server/notify/webhook.ts` exporting `notifyIncident(incident): Promise<void>` that POSTs a small JSON payload (`{ id, projectId, title, serviceName, highestLevel, firstSeen, totalEvents, url }`) to `env.ALERT_WEBHOOK_URL`. No-op when the env var is unset (flag off). Use a short timeout and catch+log failures (never throw into ingest).

### Step 3: Wire at the emit site

In BOTH ingest routes, where `touchedIncidents` are emitted, additionally call `notifyIncident(incident)` when `incident.isNew` and the flag is on. Keep it AFTER commit and fire-and-forget (do not await in a way that blocks the response longer than necessary — but DO ensure the process doesn't exit first; in the SvelteKit/Bun server it won't).

**Verify**: integration test — POST an ingest payload with a new error → assert the webhook fn was invoked once with the expected payload (mock the fetch); POST a duplicate → assert NOT invoked.

### Step 4: Document + validate

Write the docs section. Run the full suite.

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → pass; `bun run knip` → no new unused.

## Spike exit (go/no-go gate)

STOP here and report:

- Did Step 1 reliably yield `isNew`/`wasReopened`? Under both PGlite and Postgres?
- Does the end-to-end slice fire exactly once per new incident and never on updates?
- The recommended full-build shape: per-project webhook column, outbox/retry, anti-spam, Slack formatting — with effort estimates.
- A go/no-go recommendation for the full build.

Do NOT proceed to the full build without sign-off.

## Done criteria (for the SPIKE)

- [ ] `upsertIncidentsForPreparedLogs` (or the emit site) can reliably flag new vs. updated incidents, proven by tests under PGlite (and reasoned for Postgres / covered by E2E)
- [ ] A flag-gated webhook notifier exists and is a no-op when unconfigured
- [ ] Integration test: new incident → one webhook call with correct payload; updated incident → none
- [ ] Alerting fires from the server/ingest path independent of any SSE subscriber
- [ ] Docs describe the env var + payload
- [ ] `bun run test:integration`, `bun run check`, `vp check`, `bun run knip` all green
- [ ] A written go/no-go report covering the open questions above
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1 cannot distinguish new from updated incidents reliably → STOP, report (direction blocked without it).
- Plan 012 has changed the upsert shape in a way that conflicts → coordinate sequencing before proceeding.
- Adding outbound HTTP from the ingest path measurably regresses ingest latency in tests → move to fully async/out-of-band and report.

## Maintenance / full-build notes

- The full build needs: per-project webhook config (schema + settings UI), an outbox table for at-least-once delivery with retry/backoff, anti-spam (token bucket per project or fingerprint-window dedup), and channel adapters (Slack/Discord/PagerDuty payload shapes).
- If the deployment ever runs multiple processes, the in-memory event bus won't fan out across them — but alerting fired from the ingest path (not the SSE path) is per-process-correct as long as ingest is where the webhook fires. Document this.
- Coordinate with plan 019 (incident lifecycle): once incidents have real ack/mute state, alerting should respect "muted" incidents (suppress alerts). The spike predates that; note the dependency.
