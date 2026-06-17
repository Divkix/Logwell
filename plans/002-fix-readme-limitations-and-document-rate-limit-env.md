# Plan 002: Correct README "Current Limitations" and document the rate-limit env vars

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- README.md .env.example src/lib/server/utils/rate-limit.ts src/routes/api/projects/'[id]'/logs/export/+server.ts` — if any changed, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

The README's "Current Limitations" table tells prospective users that Logwell has **"No log export"** and **"No rate limiting"** — both false. Log export ships (`src/routes/api/projects/[id]/logs/export/+server.ts`, CSV + JSON, surfaced in the UI) and rate limiting ships (`src/lib/server/utils/rate-limit.ts`, wired into login and both ingest routes). Stale docs that are _wrong_ are worse than missing: evaluators discount the project for features it already has, and the table even recommends workarounds (pg_dump, reverse-proxy rate limiting) the app already provides. Separately, the two rate-limit env vars are read by code but documented nowhere, so operators can't tune them.

## Current state

**The two false limitation rows** — `README.md`, in the "## Current Limitations" section (search for the literal table; the rows read approximately):

```markdown
| **No log export** | Can't backup to S3/file | Direct database dumps via `pg_dump` |
| **No rate limiting** | API keys have unlimited access | Implement at reverse proxy level |
```

The third row, `**Single-user auth**`, is **correct** (README "Logwell is NOT for" lists RBAC/teams as out of scope) — keep it.

**Proof export exists**: `src/routes/api/projects/[id]/logs/export/+server.ts` — `GET` route, `validateFormat` accepts `"csv" | "json"` (default json), streams via cursor pagination, capped at `EXPORT_CONFIG.MAX_LOGS` (10,000). Filename `logs-{projectName}-{date}.{ext}`. README already documents this endpoint nowhere in the API Reference table — note that gap too.

**Proof rate limiting exists**:

- `src/lib/server/utils/rate-limit.ts:18-19`:
  ```ts
  export const INGEST_RPM = parsePositiveRpm(process.env.RATE_LIMIT_INGEST_RPM, 600); // 600 req/min per key
  export const LOGIN_RPM = parsePositiveRpm(process.env.RATE_LIMIT_LOGIN_RPM, 10); // 10 req/min per IP
  ```
- Wired in `src/hooks.server.ts:60` (login, per IP) and `src/routes/v1/ingest/+server.ts:59` + `src/routes/v1/logs/+server.ts:66` (ingest, per project key), returning 429 with `Retry-After: 60`.

**`.env.example` PERFORMANCE TUNING section** currently documents SSE, log-stream, retention, and incident vars — but NOT `RATE_LIMIT_INGEST_RPM` / `RATE_LIMIT_LOGIN_RPM`. The README env-var section (`## Environment Variables`) lists a subset and also omits them.

**README env table** is under `## Environment Variables`. The `.env.example` is the more complete source; mirror its style.

## Commands you will need

| Purpose                       | Command                                                                    | Expected on success      |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| Find the limitations table    | `grep -n "No log export\|No rate limiting\|Current Limitations" README.md` | line numbers of the rows |
| Find rate-limit env reads     | `grep -rn "RATE_LIMIT_INGEST_RPM\|RATE_LIMIT_LOGIN_RPM" src/`              | confirms the var names   |
| Confirm export route          | `ls src/routes/api/projects/'[id]'/logs/export/+server.ts`                 | file exists              |
| Markdown lint (if part of vp) | `vp check`                                                                 | exit 0                   |

## Scope

**In scope** (the only files you should modify):

- `README.md` — fix the limitations table; optionally add export + rate-limit to feature/API docs
- `.env.example` — add the two rate-limit vars under PERFORMANCE TUNING

**Out of scope** (do NOT touch):

- Any source file under `src/` — this is a docs-only plan. Do not change rate-limit defaults or the export route.
- `AGENTS.md`.
- The `**Single-user auth**` limitation row — it is accurate; leave it.

## Git workflow

- Branch: `advisor/002-readme-limitations-docs`
- Commit message: `docs: correct stale limitations and document rate-limit env vars`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Remove the two false rows from "Current Limitations"

Edit the `## Current Limitations` table in `README.md`. Delete the **"No log export"** and **"No rate limiting"** rows. Keep **"Single-user auth"**. If removing two of three rows makes the table look thin, you may add an honest replacement row or two grounded in real constraints (examples that are actually true today): "No alerting/notifications (incidents are detected but not pushed)" and "No programmatic read API (logs readable via UI/session only, not API key)". Only add rows you can verify from the codebase; do not invent limitations.

**Verify**: `grep -n "No log export\|No rate limiting" README.md` → no matches.

### Step 2: Document log export in the API Reference

In the README "## API Reference" → "Project Management (Session Auth)" table, add a row for the existing export endpoint (it is currently undocumented):

```markdown
| `/api/projects/[id]/logs/export` | GET | Export logs as CSV or JSON (`?format=csv\|json`, max 10,000) |
```

**Verify**: `grep -n "logs/export" README.md` → at least one match in the API table.

### Step 3: Document the rate-limit env vars in `.env.example`

Add a "Rate Limiting" subsection under the PERFORMANCE TUNING block in `.env.example`, matching the existing comment style (default + range + commented-out example). Use exactly these defaults from `rate-limit.ts`:

```sh
# Rate Limiting
# -------------

# Max ingest requests per minute, per project API key (token bucket)
# Default: 600
# RATE_LIMIT_INGEST_RPM="600"

# Max login attempts per minute, per client IP (brute-force protection)
# Default: 10
# RATE_LIMIT_LOGIN_RPM="10"
```

**Verify**: `grep -n "RATE_LIMIT_INGEST_RPM\|RATE_LIMIT_LOGIN_RPM" .env.example` → both present.

### Step 4: Mention rate limiting in README env/features (optional but recommended)

Add the two vars to the README "## Environment Variables" optional section (mirroring how `LOG_RETENTION_DAYS` etc. are shown). Optionally move "rate limiting" and "log export" into the "## Features" list if it reads naturally. Keep edits factual.

**Verify**: `grep -n "RATE_LIMIT" README.md` → present.

## Test plan

Docs-only; no automated tests. Verification is the `grep` checks above plus `vp check` (if it lints markdown in this repo) passing.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "No log export" README.md` returns 0
- [ ] `grep -c "No rate limiting" README.md` returns 0
- [ ] `grep -q "logs/export" README.md` (export documented)
- [ ] `grep -q "RATE_LIMIT_INGEST_RPM" .env.example` AND `grep -q "RATE_LIMIT_LOGIN_RPM" .env.example`
- [ ] Only `README.md` and `.env.example` modified (`git status`)
- [ ] `vp check` exits 0 (if it covers markdown; otherwise N/A)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current Limitations" rows in README do not match the "Current state" excerpt (text drifted — find the current wording and report before editing).
- The export route file is absent or no longer accepts `csv`/`json` (the feature changed — re-verify before documenting).
- `rate-limit.ts` no longer exports `INGEST_RPM`/`LOGIN_RPM` with those env var names or those defaults (re-read and use the live values).

## Maintenance notes

- For the reviewer: verify every claim added to the README is backed by current code (export formats, rate-limit defaults).
- If a future plan adds incident alerting (see `plans/017-spike-incident-alerting-webhooks.md`) or a programmatic read API (`plans/018-spike-read-query-api-and-sdks.md`), the "Current Limitations" rows added in Step 1 must be removed again — note this cross-dependency.
- Keep `.env.example` as the single most complete env reference; the README env section is intentionally a subset.
