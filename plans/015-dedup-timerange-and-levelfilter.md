# Plan 015: Deduplicate `getTimeRangeStart` (×4, drifted) and `parseLevelFilter` (×3) — the `TODO(RT-10)` cluster

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git grep -n "TODO(RT-10)\|parseLevelFilter\|getTimeRangeStart" 8ec01b0 -- src/` then `git grep -n "TODO(RT-10)\|parseLevelFilter\|getTimeRangeStart" -- src/` and compare — if the set of call sites differs from "Current state", treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (touches multiple read-path query builders; behavior must stay identical)
- **Depends on**: none. Best landed AFTER plan 005 (knip fix) so the dead-code checker can confirm no orphaned copies remain.
- **Category**: tech-debt
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

Two small parsing helpers are copy-pasted across the logs/stats/incidents read paths, and the copies have **drifted** — the dangerous kind of duplication. The repo's own `TODO(RT-10)` comments flag exactly these. Drift means a fix or filter-validation tweak applied in one place silently misses the others, and the variants disagree on edge cases (null handling, return types). Consolidating to one source of truth removes the drift risk and the standing TODOs.

## Current state

### `parseLevelFilter` — 3 copies, byte-identical (safe to extract verbatim)

All three are the SAME implementation:

- `src/routes/api/projects/[id]/logs/+server.ts:28` (no TODO comment)
- `src/routes/api/projects/[id]/logs/export/+server.ts:29` (comment: `// TODO: deduplicate with logs/+server.ts parseLevelFilter (RT-10)`)
- `src/routes/(app)/projects/[id]/+page.server.ts:24` (comment: `// TODO(RT-10): deduplicate ...`)

The canonical body (from `logs/+server.ts`):

```ts
function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;
  const levels = levelParam
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel));
  return levels.length > 0 ? levels : null;
}
```

`LOG_LEVELS` and `LogLevel` come from `$lib/shared/types` (re-exported from `$lib/shared/schemas/log`, where `LOG_LEVELS = ["debug","info","warn","error","fatal"] as const`).

### `getTimeRangeStart` — 1 canonical + 2 drifted local copies + correct importers

- **Canonical**: `src/lib/utils/format.ts:91` — `getTimeRangeStart(range: "15m" | "1h" | "24h" | "7d", referenceTime?: Date): Date`. Strict union input, **non-null** `Date` return, exhaustive switch (no `default`). Unit-tested in `format.unit.test.ts`.
- **Correct importers** (validate the raw param against an allowlist, THEN call the canonical fn): `routes/api/projects/[id]/incidents/+server.ts:50`, `.../incidents/[incidentId]/timeline/+server.ts:42`, `routes/(app)/projects/[id]/incidents/+page.server.ts:57`, `routes/api/projects/[id]/stats/timeseries/+server.ts`. These import from `$lib/utils/format` and pass a value already narrowed to `INCIDENT_RANGES`/`VALID_RANGES`. **Leave these alone.**
- **Drifted local copies** (different signature: `(range: string | null): Date | null`, with a `default: return null`):
  - `src/routes/(app)/projects/[id]/stats/+page.server.ts:8` (`// TODO(RT-10): deduplicate with $lib/utils/format getTimeRangeStart`)
  - `src/routes/(app)/projects/[id]/+page.server.ts:36` (`// TODO(RT-10): deduplicate ...`)
  - (`src/lib/components/export-button.svelte:21` has a CLIENT-side `getTimeRangeStart(timeRange: TimeRange | undefined): Date | null` — a third variant. Evaluate but treat with care: it's a Svelte component, client-side. See Step 4.)

`TimeRange = "15m" | "1h" | "24h" | "7d"` is owned by `$lib/utils/time-range.ts` (alongside `TIME_RANGES`). `INCIDENT_RANGES` (`$lib/shared/schemas/incident.ts`) has the identical four values.

**The drift**: canonical takes a strict union and never returns null; the two page-loader copies take `string | null` and return `Date | null` (returning null for unknown/missing). So they can't be swapped 1:1 without handling the validation/null step at the call site.

## The plan

1. **`parseLevelFilter`**: extract the identical implementation to ONE shared function and import it in all three sites.
2. **`getTimeRangeStart`**: add a small validated parser next to the canonical function so the drifted `string | null → Date | null` behavior is expressed as `parse + canonical`, then delete the two local copies. Keep the strict canonical `getTimeRangeStart` as-is (its unit tests stay green).

### Where to put the shared `parseLevelFilter`

It parses a query param into domain levels and is used by BOTH server routes and a server page loader. Put it in a server-or-shared util. Recommended: `src/lib/shared/schemas/log.ts` already owns `LOG_LEVELS` — add `parseLevelFilter` there (it's pure, no server-only imports), exported, and import via `$lib/shared/schemas/log` (or the `$lib/shared/types` re-export). Confirm no circular import results.

### The `getTimeRangeStart` parser

Add to `src/lib/utils/time-range.ts` (it owns `TimeRange` and `TIME_RANGES`):

```ts
export function parseTimeRange(param: string | null): TimeRange | null {
  return param && (TIME_RANGES as readonly string[]).includes(param) ? (param as TimeRange) : null;
}
```

Then in each drifted call site:

```ts
import { getTimeRangeStart } from "$lib/utils/format";
import { parseTimeRange } from "$lib/utils/time-range";
// ...
const range = parseTimeRange(rangeParam);
const fromDate = range ? getTimeRangeStart(range) : null;
```

This reproduces the old `Date | null` semantics exactly (unknown/missing → null) while routing through the single canonical date math.

## Commands you will need

| Purpose                          | Command                                                      | Expected              |
| -------------------------------- | ------------------------------------------------------------ | --------------------- |
| Format/util unit tests           | `bun run test:unit -- format` and `-- time-range`            | pass                  |
| Logs/stats/incidents integration | `bun run test:integration -- logs` `-- stats` `-- incidents` | pass                  |
| Dead-code check                  | `bun run knip`                                               | no NEW unused exports |
| Typecheck                        | `bun run check`                                              | exit 0                |
| Lint                             | `vp check`                                                   | exit 0                |
| Full                             | `bun run test`                                               | pass                  |

## Scope

**In scope** (modify):

- `src/lib/shared/schemas/log.ts` — add exported `parseLevelFilter`
- `src/lib/utils/time-range.ts` — add exported `parseTimeRange`
- `src/routes/api/projects/[id]/logs/+server.ts` — import `parseLevelFilter`, delete local copy
- `src/routes/api/projects/[id]/logs/export/+server.ts` — same, delete local copy + RT-10 comment
- `src/routes/(app)/projects/[id]/+page.server.ts` — import both helpers, delete both local copies + RT-10 comments
- `src/routes/(app)/projects/[id]/stats/+page.server.ts` — use `parseTimeRange` + canonical, delete local copy + RT-10 comment
- (optional) a unit test for `parseTimeRange` and `parseLevelFilter`

**Out of scope** (do NOT touch):

- The canonical `getTimeRangeStart` in `format.ts` and its unit tests — must stay byte-identical (no signature change).
- The four CORRECT importers of `getTimeRangeStart` (incidents/timeline/timeseries) — they already validate then call; leave them.
- Any actual query/filter LOGIC beyond swapping the helper — the WHERE conditions, ranges, and outputs must be unchanged.
- `export-button.svelte` unless Step 4 confirms a clean, safe swap (client-side; lower priority).

## Git workflow

- Branch: `advisor/015-dedup-rt10`
- Commit message: `refactor: dedup getTimeRangeStart and parseLevelFilter (RT-10)`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Extract `parseLevelFilter`

Add the canonical implementation to `src/lib/shared/schemas/log.ts` (exported). Replace all three local copies with an import. Verify the three copies were byte-identical first (`git grep -A6 "function parseLevelFilter"`); if any differs, STOP and report the difference rather than assuming.

**Verify**: `bun run check` → 0; `bun run test:integration -- logs` and `-- export` pass.

### Step 2: Add `parseTimeRange` and migrate the two page loaders

Add `parseTimeRange` to `time-range.ts`. In `(app)/projects/[id]/+page.server.ts` and `(app)/projects/[id]/stats/+page.server.ts`, delete the local `getTimeRangeStart`, import the canonical one + `parseTimeRange`, and replace usage with `const range = parseTimeRange(rangeParam); const fromDate = range ? getTimeRangeStart(range) : null;`. Remove the `TODO(RT-10)` comments.

Note the stats loader currently defaults `rangeParam` to `"24h"` BEFORE calling its local copy, then the local copy maps it. After the change, `parseTimeRange("24h")` returns `"24h"` and `getTimeRangeStart("24h")` returns the right Date — behavior preserved. Double-check the default-handling for each loader so an absent `range` yields the SAME `fromDate` as before.

**Verify**: `bun run check` → 0; `bun run test:integration -- stats` and the logs page loader tests pass.

### Step 3: Confirm behavior parity

For each migrated call site, reason through three inputs and confirm identical output to the old copy: a valid range (`"1h"`), an absent param (`null`), and an invalid param (`"99z"`). Old copies returned `Date | null` with null for absent/invalid — `parseTimeRange` + ternary reproduces this. Where a loader defaulted to `"24h"`, ensure the default still applies.

**Verify**: add or extend a unit test asserting `parseTimeRange(null) === null`, `parseTimeRange("99z") === null`, `parseTimeRange("7d") === "7d"`.

### Step 4: Evaluate the `export-button.svelte` copy (optional, careful)

`src/lib/components/export-button.svelte:21` has a client-side `getTimeRangeStart(timeRange: TimeRange | undefined): Date | null`. If it's value-equivalent to `parseTimeRange` + canonical, you MAY replace its body with `const d = range ? getTimeRangeStart(range) : null;` importing from `$lib/utils/format`. BUT: confirm `format.ts` has no server-only imports that would bloat the client bundle (it appears pure date formatting — verify). If there's ANY doubt about client-bundle safety, LEAVE this copy and note it in maintenance notes. Do not risk the bundle for a cosmetic dedup.

**Verify**: `vp check` → 0; if changed, `bun run test:unit` (component tests) pass and `bun run sdk:build`/size unaffected (component bundle).

### Step 5: Dead-code + full validation

**Verify**: `bun run knip` shows no NEW unused exports (the new shared functions ARE used; the deleted local ones are gone); `bun run check` → 0; `vp check` → 0; `bun run test` → pass.

## Test plan

- Unit: `parseTimeRange` (valid/invalid/null) and `parseLevelFilter` (csv, trimming, lowercasing, invalid filtered out, empty → null).
- Integration: logs, export, stats, and the logs page loader still return identical filtered/ranged results (existing suites cover the query behavior).
- knip confirms no orphaned copies remain.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git grep -n "function parseLevelFilter" src/` shows exactly ONE definition (in the shared module)
- [ ] `git grep -n "function getTimeRangeStart" src/` shows exactly ONE definition (the canonical `format.ts`) — the two page-loader copies are gone
- [ ] `git grep -n "TODO(RT-10)" src/` returns NOTHING
- [ ] `parseTimeRange` exists in `time-range.ts` and is used by the two former-copy loaders
- [ ] The four correct `getTimeRangeStart` importers are unchanged (`git diff` shows no edits there)
- [ ] `bun run test` passes; `bun run knip` shows no new unused exports; `bun run check` and `vp check` exit 0
- [ ] Only the in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The three `parseLevelFilter` copies are NOT byte-identical (a hidden behavioral difference exists — report it; do not silently pick one).
- A migrated call site's `fromDate` differs for any of {valid, null, invalid} input vs the old copy (parity broken — report).
- Putting `parseLevelFilter` in `shared/schemas/log.ts` creates a circular import (move it to a dedicated `$lib/shared/query-params.ts` and report).
- `export-button.svelte` change pulls server-only code into the client bundle (revert that one file, keep the rest).
- The call-site set differs from "Current state" (the drift-check git grep mismatch).

## Maintenance notes

- For the reviewer: the only real risk is behavior drift during consolidation. Verify the null/default handling at each migrated loader matches the old copy exactly.
- After this lands, there is ONE date-range function and ONE level-filter function. Any future range/level change happens once.
- If `INCIDENT_RANGES` and `TIME_RANGES` ever diverge in value sets, `parseTimeRange` (built on `TIME_RANGES`) and the incident validators must be reconciled — today they're identical four-value sets.
