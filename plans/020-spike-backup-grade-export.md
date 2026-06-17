# Plan 020 (SPIKE): Backup-grade export (full-fidelity, uncapped, restorable)

> **Nature**: DESIGN + SPIKE plan. Validate the fidelity + round-trip model on
> a slice, then STOP at the "Spike exit" gate for a go/no-go. Do NOT build a
> full backup/restore product (scheduling, object-storage targets) in the spike.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/api/projects/'[id]'/logs/export src/lib/server/config/performance.ts src/lib/server/db/schema.ts` — re-read changed files before relying on "Current state".

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: independent. Shares the level/filter helper with plan 015 (the export route is one of the `parseLevelFilter` copies) — sequence after 015 to avoid churn.
- **Category**: direction / feature
- **Planned at**: commit `8ec01b0`, 2026-06-17

## The opportunity

There IS an export endpoint, but it's a **UI convenience**, not a backup tool. The gap between "export for a spreadsheet" and "export I can restore from" is exactly what self-hosters need for data ownership and disaster recovery. Closing it makes Logwell trustworthy as a system of record.

## Current state (what today's export is and isn't)

`GET /api/projects/[id]/logs/export` (`src/routes/api/projects/[id]/logs/export/+server.ts`):

- **Session-auth, ownership-gated** (`requireProjectOwnership`) — browser-only, NOT scriptable.
- Streams CSV or JSON via cursor pagination (good — memory-safe). `EXPORT_BATCH_SIZE = 500`.
- **Hard-capped** at `EXPORT_CONFIG.MAX_LOGS` (10,000) — returns `400 export_too_large` beyond that. A backup must not silently drop data.
- **Lossy projection** — exports only: `id, timestamp, level, message, metadata, sourceFile, lineNumber, requestId, userId, ipAddress`. It DROPS the OTLP fields the schema stores: `body, severityNumber, severityText, traceId, spanId, flags, timeUnixNano, observedTimeUnixNano, resourceAttributes, resourceSchemaUrl, resourceDroppedAttributesCount, scopeName, scopeVersion, scopeAttributes, scopeSchemaUrl, scopeDroppedAttributesCount, droppedAttributesCount, fingerprint, incidentId, serviceName`. So today's JSON export is NOT a faithful copy and could not reconstruct the rows.
- No incidents/projects in the export — logs only.
- No import/restore path exists.

So "backup-grade" = (1) full-fidelity columns, (2) uncapped/streamed, (3) programmatic auth so it can be scheduled, (4) a defined restore path.

## Design decisions to resolve in the spike

1. **Fidelity format**: define a versioned, line-delimited JSON (NDJSON) "backup" format that includes EVERY persisted log column (not the lossy subset), with a small header record (`{ version, projectId, exportedAt, schemaVersion }`). NDJSON streams cleanly and re-imports row-by-row without loading the whole file. Keep the existing CSV/JSON UI export AS-IS (it serves a different purpose) — add backup as a NEW format/endpoint, don't break the convenience export.
2. **Cap**: backup must not enforce the 10k cap. Keep cursor streaming (already memory-safe) but remove/raise the limit for the backup path. Validate streaming a large set doesn't time out the request (may need chunked transfer / keep-alive; the existing `ReadableStream` already does this).
3. **Auth**: backup should be scriptable → API-key auth (like ingest), OR keep session-auth for the spike and flag API-key as the real-build need. Coordinate with plan 018 (which establishes the API-key read pattern) — backup is a natural consumer of that pattern. Recommend: spike on session-auth to prove fidelity + round-trip, then move to API-key once 018 lands.
4. **Restore/import**: the load-bearing new capability. A `POST` import endpoint that ingests a backup NDJSON, preserving original ids/timestamps/fingerprints (NOT re-generating them — a restore must be faithful). Must handle conflicts (id already exists → skip or upsert?) and re-link `incidentId`. Decide idempotency semantics.
5. **Scope of a backup**: logs only, or logs + incidents + project metadata? For true restore you need incidents too (logs reference `incidentId`). Decide whether the spike does logs-only round-trip first (re-deriving incidents via the existing backfill, `incident-backfill.ts`) or includes incidents.

## Scope of the SPIKE (prove fidelity + round-trip)

**In scope**:

- Define + document the versioned NDJSON backup format (header + full-fidelity log records).
- Add a backup EXPORT path (new `format=backup` on the existing endpoint OR a new `/export/backup` route) that streams ALL columns with NO 10k cap, reusing the cursor-stream machinery. Session-auth is fine for the spike.
- Add a minimal IMPORT endpoint that reads the NDJSON and inserts logs preserving ids/timestamps/fingerprints, with a defined conflict rule (recommend skip-on-existing-id for safety).
- A round-trip integration test: seed N logs (with rich OTLP fields) → export backup → wipe → import → assert the restored rows are field-for-field identical to the originals (the WHOLE point).
- Reuse `incident-backfill.ts` to re-derive incidents post-import (logs-only backup), OR include incidents — decide in Step 1.
- Docs: backup format spec + export/import usage + caveats.

**Explicitly OUT of scope for the spike**:

- Scheduling / cron / automated backups.
- Object-storage targets (S3/R2) — that's an operator concern, out of band.
- Compression/encryption of the backup stream (note as real-build options).
- API-key auth on the backup path (do after plan 018; spike uses session-auth).
- A UI for restore (CLI/script only for the spike).

## Spike steps

### Step 1: Decide backup scope (logs-only vs logs+incidents) and define the format

Write the NDJSON spec (header + record schema = full log columns). Decide logs-only (re-derive incidents on import via `incident-backfill.ts`) vs. include incidents. Logs-only is simpler and `incident-backfill.ts` already exists to rebuild incidents — recommend that for the spike.

**Deliverable**: a short format spec doc.

### Step 2: Full-fidelity, uncapped export path

Add the backup export reusing the existing cursor-stream loop but selecting ALL columns (mirror the full `log` column set) and removing the `MAX_LOGS` cap for this path. Header record first, then one JSON object per line.

**Verify**: integration test — export a set with populated OTLP fields (body, traceId, resourceAttributes, etc.) and assert every field is present in the output (no lossy projection).

### Step 3: Import/restore endpoint

Add a `POST` import that parses NDJSON line-by-line and inserts logs preserving original `id`, `timestamp`, `fingerprint`, etc. Conflict rule: skip rows whose `id` already exists (idempotent re-import). Ownership-gated. After import (logs-only), optionally run `incident-backfill` for the project to rebuild incidents.

**Verify**: integration test — import a known backup, assert rows exist with original ids/fields.

### Step 4: Round-trip test (the keystone)

Seed logs with rich fields → export backup → delete those logs → import the backup → assert restored rows are field-for-field identical (ids, timestamps, body, attributes, all of it). This proves "backup-grade".

**Verify**: the round-trip test passes; `bun run test:integration` green.

### Step 5: Document + validate

Format spec + usage docs. Run everything.

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:integration` → pass; `bun run knip` → no new unused. Confirm the EXISTING convenience CSV/JSON export is unchanged (its tests still pass).

## Spike exit (go/no-go gate)

STOP and report:

- The backup format spec (versioned) and scope decision (logs-only vs +incidents).
- Round-trip fidelity result: is the restore truly field-for-field identical?
- Conflict/idempotency semantics chosen.
- Streaming behavior for large/uncapped exports (any timeout concerns).
- The real-build needs: API-key auth (via plan 018), scheduling, object-storage targets, compression/encryption.
- Go/no-go recommendation.

## Done criteria (for the SPIKE)

- [ ] A versioned NDJSON backup format is documented (header + full log-column records)
- [ ] A backup export path streams ALL persisted log columns with NO 10k cap (full fidelity), reusing the cursor stream
- [ ] An import endpoint restores logs preserving original ids/timestamps/fingerprints with a defined conflict rule
- [ ] A round-trip test proves export→wipe→import yields field-for-field identical rows
- [ ] The existing convenience CSV/JSON export is unchanged (its tests still pass)
- [ ] `bun run test:integration`, `bun run check`, `vp check`, `bun run knip` green
- [ ] Written go/no-go report with the format spec
- [ ] `plans/README.md` status row updated

## STOP conditions

- Round-trip is NOT field-for-field identical (a column is dropped or transformed) → the format/projection is wrong; fix before claiming backup-grade.
- Uncapped streaming export times out or exhausts memory in tests → the streaming approach needs rework (report; do not ship a backup that dies on large datasets).
- Preserving original ids on import collides with id-generation assumptions elsewhere (e.g. a NOT NULL/unique constraint or a generated id) → report.
- Including incidents creates FK ordering problems on import (`log.incidentId` → `incident.id`) → fall back to logs-only + backfill and report.

## Maintenance / full-build notes

- Move the backup path to API-key auth once plan 018 establishes the pattern, so backups can be scheduled by scripts/cron without a browser session.
- Real backups want: compression (gzip the NDJSON stream), optional encryption, and pluggable targets (local file, S3/R2) — all out of band from the app, documented for operators.
- Keep the backup format VERSIONED from day one; restore must check the version header and refuse/upgrade unknown versions.
- The faithful-restore requirement (preserve ids/fingerprints) is the opposite of ingest (which generates ids) — keep the two paths clearly separated so a backup import never accidentally goes through the id-generating ingest path.
- If plan 014 (tsvector) changes the `search` generated column, backup/restore is unaffected (search is generated, not exported/imported) — but note it so a future schema change doesn't surprise the restore path.
