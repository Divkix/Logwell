# Plan 019 (SPIKE): Incident lifecycle — acknowledge / mute / manual resolve

> **Nature**: DESIGN + SPIKE plan. The big risk here is a SCHEMA + semantics
> change to a core table. Validate the model with a thin slice, then STOP at
> the "Spike exit" gate for a go/no-go. Do NOT build the full UI + all states
> in the spike.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/lib/server/utils/incidents.ts src/lib/server/db/schema.ts src/routes/api/projects/'[id]'/incidents drizzle/` — re-read changed files before relying on "Current state".

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH (changes the meaning of "incident status" across the app + schema migration on a core table)
- **Depends on**: relates to plan 017 (alerting should respect "muted"). Independent of perf/test plans.
- **Category**: direction / feature
- **Planned at**: commit `8ec01b0`, 2026-06-17

## The opportunity

Incidents today have NO user-actionable lifecycle. Status is **purely computed**: `getIncidentStatus(lastSeen)` returns `open` if `lastSeen` is within `INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES`, else `resolved`. A user cannot acknowledge ("I'm on it"), mute ("known issue, stop bugging me"), or manually resolve/reopen an incident. For an error-tracking workflow this is the difference between a noticeboard and a tool a team actually operates from.

## Current state (and a telling piece of history)

- **Status is computed, not stored**: `getIncidentStatus(lastSeen, now, autoResolveMinutes)` in `incidents.ts:172`. Used by the incidents list (`api/.../incidents/+server.ts:114`), the detail route, and the `(app)` incidents page. There is no `status` column.
- **The incident table** (`schema.ts:57-78`) has NO lifecycle columns: just identity, fingerprint, title, level, `firstSeen`/`lastSeen`, `totalEvents`, timestamps.
- **HISTORY — someone already tried this and backed it out**: migration `0005_incident_intelligence.sql` added `reopen_count integer NOT NULL DEFAULT 0`; migration `0006_neat_cleanup.sql` then `DROP COLUMN IF EXISTS "reopen_count"`. So a prior reopen-tracking attempt was reverted. **Before designing, understand WHY it was removed** (git log/blame on those migrations and `incidents.ts`) — there may be a known reason the computed-only model was chosen. This is a STOP-and-investigate precondition.
- **Auto-resolve is implicit**: an incident "resolves" simply by not receiving events. Any manual lifecycle must reconcile with this auto behavior (e.g. a new event on a manually-resolved incident — does it reopen? does it alert?).

## The core semantic problem to resolve in the spike

Introducing stored lifecycle state means **two sources of truth** for status: the computed `lastSeen`-based state and the user-set state. The spike's central job is to define how they compose. Key cases to nail down:

1. **Acknowledge**: a user marks an open incident acknowledged. New events still arrive. Does "ack" survive new events, or does a new event clear it? (Common choice: ack persists until resolved or until a NEW event after ack → "un-acks" / re-alerts. Decide explicitly.)
2. **Mute**: suppress alerts (plan 017) and optionally hide from the default list, for a duration or until a condition. Muting must NOT lose events (still aggregate `totalEvents`), only suppress notification/visibility.
3. **Manual resolve**: user resolves an incident that's still receiving events (or just resolved-by-time). If a NEW event arrives after manual resolve → reopen (this is exactly what `reopen_count` was for — and was removed; understand why).
4. **Auto vs manual**: precedence rules. E.g. manual resolve overrides computed-open until a new event; computed-resolved (quiet) vs manual states.

Do NOT pick these by gut — write them down, get them reviewed at the gate.

## Design decisions to resolve

1. **Schema**: add nullable lifecycle columns to `incident` — candidate set: `acknowledgedAt`, `acknowledgedBy`, `mutedUntil` (timestamp, null = not muted), `resolvedAt`, `resolvedBy`, and possibly re-introduce `reopenCount`. Migration on a core table — coordinate with any other incident-table migration (plan 014 touches `log`, not `incident`, so no conflict there).
2. **Status computation**: replace `getIncidentStatus(lastSeen)` with a function that composes stored state + `lastSeen`. This is the highest-blast-radius change — every status consumer must move to it atomically.
3. **API**: a `PATCH /api/projects/[id]/incidents/[incidentId]` action (session-auth, ownership-gated) accepting `{ action: "ack" | "mute" | "resolve" | "reopen", mutedUntil? }`. There's already a detail route (`incidents/[incidentId]/+server.ts`) to extend.
4. **Reopen-on-new-event**: where the ingest upsert touches an existing incident, if it was manually resolved, flip it back to open (and bump `reopenCount` if reintroduced). This is logic in `incidents.ts` upsert — coordinate with plan 012 (batched upsert) and plan 017 (which also wants new/reopen detection — SHARE that mechanism).
5. **List/filter semantics**: the incidents list filters by computed `open`/`resolved` (`api/.../incidents/+server.ts`). Acknowledged/muted/manually-resolved must slot into the filter/status enum coherently.

## Scope of the SPIKE (thinnest meaningful slice)

**In scope**:

- Investigate the `reopen_count` removal history and report findings (gate precondition).
- Write the composed-status state machine as a spec (the cases above) + implement `computeIncidentStatus(incident, now)` covering ONE new action end-to-end: **acknowledge** (lowest-risk, additive, doesn't fight auto-resolve).
- Schema migration adding `acknowledgedAt` + `acknowledgedBy` (nullable) only.
- `PATCH` endpoint supporting `action: "ack"` (and "unack"), ownership-gated, with tests.
- Move status consumers to `computeIncidentStatus` (even if only ack changes behavior now) so there's ONE status function.
- Tests: ack persists across reads; ack visible in list/detail; new event behavior per the chosen rule; ownership enforced (can't ack another user's incident).

**Explicitly OUT of scope for the spike**:

- Mute and manual-resolve/reopen (design them in the spec, implement after ack validates the pattern).
- UI beyond what a test needs (the `(app)` incident page buttons come in the full build).
- Re-introducing `reopenCount` (decide in the gate based on the history investigation).
- Alert suppression for muted incidents (that's plan 017 territory; note the dependency).

## Spike steps

### Step 1: Investigate the reopen_count reversal (PRECONDITION)

`git log -p --follow drizzle/0006_neat_cleanup.sql` and blame `incidents.ts` / `getIncidentStatus`. Understand why stored reopen tracking was removed and whether the computed-only model was a deliberate simplification. **Report findings before writing schema.**

**Gate**: if the history reveals a hard reason stored lifecycle was rejected (e.g. a multi-process consistency problem), STOP and surface it.

### Step 2: Write the composed-status spec

Document the state machine: inputs (`lastSeen`, `acknowledgedAt`, future `mutedUntil`/`resolvedAt`), the precedence rules, and the new-event transitions. Keep it short but explicit. This is the deliverable that gets reviewed.

### Step 3: Implement `computeIncidentStatus` + migrate consumers

Add the composed function (extend/replace `getIncidentStatus`). Move ALL consumers (list, detail, page loader) to it in one change so status is computed in exactly one place. With only ack added, computed behavior is unchanged except acknowledged incidents report an `acknowledged` status/flag.

**Verify**: `bun run test:integration -- incidents` green; existing status unit tests updated to the new function.

### Step 4: Schema + PATCH ack endpoint

Add the migration (`acknowledgedAt`, `acknowledgedBy` nullable). Extend the incident detail route with `PATCH` for `ack`/`unack`, ownership-gated via `requireProjectOwnership`.

**Verify**: integration tests — ack sets the fields and surfaces in list/detail; unack clears; non-owner gets 404; invalid action 400.

### Step 5: Validate

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → pass; `bun run knip` → no new unused; migration applies cleanly (`bun run db:migrate`).

## Spike exit (go/no-go gate)

STOP and report:

- The reopen_count history findings.
- The reviewed status state machine (all of ack/mute/resolve/reopen + auto-resolve composition).
- How ack validated the pattern; what mute/resolve/reopen need (schema + reopen-on-event logic shared with plan 017).
- Migration/operational notes for the core-table change.
- Go/no-go for the full lifecycle build.

## Done criteria (for the SPIKE)

- [ ] Written findings on why `reopen_count` was removed (0005→0006)
- [ ] A reviewed, explicit composed-status state machine spec
- [ ] `computeIncidentStatus` is the SINGLE status function; all consumers use it (`grep` shows no remaining direct `getIncidentStatus(lastSeen)`-only callers bypassing it)
- [ ] Migration adds `acknowledgedAt`/`acknowledgedBy` (nullable) and applies cleanly
- [ ] `PATCH` ack/unack endpoint exists, ownership-gated, with tests (incl. non-owner 404)
- [ ] Existing incident status/list/detail behavior unchanged except for the new ack state
- [ ] `bun run test:integration`, `bun run check`, `vp check`, `bun run knip` green
- [ ] Written go/no-go report
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1 reveals a hard reason stored lifecycle was deliberately rejected → STOP, surface it.
- Moving all consumers to `computeIncidentStatus` changes existing open/resolved results for the no-action case → the composition is wrong; fix before adding ack.
- The incident-table migration conflicts with another in-flight incident migration → coordinate sequencing.
- Reopen-on-new-event logic collides with plan 012's batched upsert or plan 017's new/reopen detection → unify the mechanism, don't duplicate it.

## Maintenance / full-build notes

- Full build adds mute (`mutedUntil` + alert suppression in plan 017) and manual resolve/reopen (likely re-introducing `reopenCount`, informed by Step 1). Plus the `(app)` incident-page action buttons.
- Keep status computation in ONE function forever; the bug class here is "two places compute status and disagree".
- Muted incidents must still aggregate events (never drop data) — mute affects notification/visibility only.
- Coordinate the new-event-reopens-incident logic with plan 017 so an event that reopens a resolved incident can also (re-)alert.
