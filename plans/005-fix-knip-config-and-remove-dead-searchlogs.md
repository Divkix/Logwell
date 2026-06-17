# Plan 005: Tighten knip entry config and remove the dead `searchLogs` it was hiding

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- knip.json src/lib/server/utils/search.ts tests/integration/utils/search.integration.test.ts src/routes/api/projects/'[id]'/logs/+server.ts` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED
- **Depends on**: none (but ordering: do this before relying on `knip` to find other dead code)
- **Category**: tech-debt
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

`bun run knip` (part of the documented pre-commit checklist) currently reports the backend as clean — but that's a false negative. The knip `entry` glob includes `src/lib/server/**/*.ts`, marking every server module as an entry point, so unused _exports_ anywhere in the backend (the largest code area) are structurally invisible. Concrete proof: `searchLogs` in `src/lib/server/utils/search.ts` (~70 lines, carrying a second copy of the full `log` column projection) is referenced only by its own integration test, yet knip never flags it. This plan tightens the config so backend dead code surfaces, then removes the one confirmed dead export it was hiding.

## Current state

**`knip.json`** (the over-broad entry on the third line):

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "entry": [
    "src/routes/**/+{page,server,page.server,error,layout,layout.server}{,@*}.{js,ts,svelte}",
    "src/lib/index.ts",
    "src/lib/server/**/*.ts"
  ],
  "project": ["src/**/*.{js,ts,svelte}"],
  "ignore": [
    ".svelte-kit/**",
    "build/**",
    "dist/**",
    "src/app.d.ts",
    "src/lib/components/ui/**/index.ts"
  ],
  "ignoreDependencies": ["tw-animate-css", "@divkix/logwell", "layerchart", "@types/d3-scale"],
  "ignoreBinaries": ["jsr"],
  "ignoreUnresolved": ["\\$env/.+", "\\$\\{packageName\\}"],
  "drizzle": false
}
```

**The dead export** — `src/lib/server/utils/search.ts:68`:

```ts
export async function searchLogs(
  projectId: string,
  searchTerm: string,
  dbClient: DatabaseClient,
  options?: { limit?: number },
): Promise<Log[]> {
  // ~70 lines: re-lists every `log` column, computes ts_rank twice, etc.
}
```

`grep -rn "searchLogs" src/ tests/` shows the ONLY references are:

- `src/lib/server/utils/search.ts` (definition + 2 mentions in its own doc comments)
- `tests/integration/utils/search.integration.test.ts` (imports and exercises it — ~250 lines)

The live logs route does NOT use `searchLogs`; it builds search inline:

- `src/routes/api/projects/[id]/logs/+server.ts` imports `buildSearchQuery` from `search.ts` and applies `sql\`${log.search} @@ to_tsquery('english', ${tsquery})\`` directly (around line 142).

**`buildSearchQuery`** (the other export in `search.ts`) IS used by `logs/+server.ts` and `logs/export/+server.ts` — it must stay.

## Why entry vs project matters (for the executor)

In knip, files matched by `entry` are treated as roots: their exports are never reported as unused. Files matched only by `project` are analyzed — their unused exports get flagged. SvelteKit's real entry points are the route module files (`+page.ts`, `+server.ts`, `+layout.server.ts`, etc.), `hooks.server.ts`, and a few runtime-invoked modules (job schedulers, the `auth` instance, instrumentation). Internal server utilities under `src/lib/server/utils/`, `db/`, `config/` are NOT entry points — they should be analyzed as `project` files so dead exports surface.

## Commands you will need

| Purpose                  | Command                                         | Expected                  |
| ------------------------ | ----------------------------------------------- | ------------------------- |
| Run knip                 | `bun run knip`                                  | exit 0 (after Step 3)     |
| Confirm searchLogs refs  | `grep -rn "searchLogs" src/ tests/`             | only search.ts + its test |
| Typecheck                | `bun run check`                                 | exit 0                    |
| Lint                     | `vp check`                                      | exit 0                    |
| Unit + integration tests | `bun run test:unit && bun run test:integration` | pass                      |

## Scope

**In scope** (the only files you should modify/delete):

- `knip.json` — narrow the `entry` globs
- `src/lib/server/utils/search.ts` — delete the `searchLogs` function (keep `buildSearchQuery`)
- `tests/integration/utils/search.integration.test.ts` — delete (it only tests `searchLogs`); OR if it also tests `buildSearchQuery`, delete only the `searchLogs` cases (verify first)

**Out of scope** (do NOT touch):

- `buildSearchQuery` and its callers (`logs/+server.ts`, `logs/export/+server.ts`).
- Any OTHER unused export that the tightened knip config now surfaces. If knip flags additional dead code after the config change, **do NOT delete it in this plan** — record the list and report it (see STOP conditions). Removing unfamiliar "dead" code risks deleting runtime-invoked-but-statically-unreferenced modules (SvelteKit hooks, job entry points).
- `src/lib/index.ts`, `src/lib/components/ui/**` ignores — leave as-is.

## Git workflow

- Branch: `advisor/005-knip-deadcode-searchlogs`
- Commit message: `chore: tighten knip entry config and remove dead searchLogs`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Narrow the knip `entry` config

Replace the `"src/lib/server/**/*.ts"` entry glob with only the true runtime entry points that aren't already covered by the route glob. Set `entry` to:

```json
"entry": [
  "src/routes/**/+{page,server,page.server,error,layout,layout.server}{,@*}.{js,ts,svelte}",
  "src/hooks.server.ts",
  "src/lib/index.ts",
  "src/lib/server/db/index.ts",
  "src/lib/server/auth.ts",
  "src/lib/server/jobs/cleanup-scheduler.ts"
]
```

Rationale: route files + hooks are the SvelteKit roots; `db/index.ts` and `auth.ts` are lazily imported via dynamic `import()` (knip may not trace those), and `cleanup-scheduler.ts` is started from `hooks.server.ts`. Everything else under `src/lib/server/` becomes a `project` file and gets analyzed.

**Verify**: `bun run knip` now runs and reports `searchLogs` as an unused export (this is the expected, desired new signal). If it reports MANY unused exports beyond `searchLogs`, capture the full list — see STOP conditions before deleting anything else.

### Step 2: Delete the dead `searchLogs` function

In `src/lib/server/utils/search.ts`, remove the entire `searchLogs` function and its doc comment. Keep `buildSearchQuery` and its exports/imports. Remove any imports in `search.ts` that become unused after deleting `searchLogs` (e.g. `desc`, `sql`, `log`, `Log`, `DatabaseClient` — only those no longer referenced by `buildSearchQuery`).

**Verify**: `grep -n "searchLogs" src/lib/server/utils/search.ts` → no matches. `bun run check` → exit 0 (no unused-import or type errors).

### Step 3: Remove the orphaned test

Open `tests/integration/utils/search.integration.test.ts`. If every test in it calls `searchLogs` (expected — confirm with `grep -c "searchLogs" tests/integration/utils/search.integration.test.ts` vs total test count), delete the whole file. If it ALSO has `buildSearchQuery` cases, delete only the `searchLogs` describe/it blocks and keep the rest.

`buildSearchQuery` already has unit coverage in `src/lib/server/utils/search.unit.test.ts` (confirm: `grep -n "buildSearchQuery" src/lib/server/utils/search.unit.test.ts`), so deleting the integration file does not drop coverage of the surviving export.

**Verify**: `grep -rn "searchLogs" src/ tests/` → no matches anywhere.

### Step 4: Full validation

Run the gate end to end.

**Verify**: `bun run knip` → exit 0 (clean). `vp check` → exit 0. `bun run test:unit && bun run test:integration` → all pass.

## Test plan

- No new tests. Deletes one orphaned integration test for dead code.
- Confirm `buildSearchQuery` retains coverage via `search.unit.test.ts`.
- Verification command: `bun run test:unit && bun run test:integration` → all pass, with the `searchLogs` integration file removed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `knip.json` `entry` no longer contains `src/lib/server/**/*.ts`
- [ ] `grep -rn "searchLogs" src/ tests/` returns no matches
- [ ] `src/lib/server/utils/search.ts` still exports `buildSearchQuery`
- [ ] `bun run knip` exits 0 (clean)
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] `bun run test:unit && bun run test:integration` pass
- [ ] Only `knip.json`, `search.ts`, and the search integration test are modified/deleted (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- After narrowing `entry`, knip reports unused exports OTHER than `searchLogs`. Capture the full list and report it — do NOT delete them in this plan. Some may be runtime-invoked modules that need adding back to `entry`; that's a judgment call for a follow-up.
- `searchLogs` turns out to have a non-test caller (the `grep` shows references outside `search.ts` and its test) — it is not dead; STOP.
- Deleting `searchLogs` causes `bun run check` type errors in any file other than the deleted test (something imported it that the grep missed).
- `buildSearchQuery` has no surviving coverage after Step 3 (then keep a minimal test for it).

## Maintenance notes

- For the reviewer: the key risk is the knip `entry` change over-narrowing and flagging a legitimately-entry module. Scrutinize the new unused-export list (Step 1) — if anything runtime-invoked appears, it should be added to `entry`, not deleted.
- This plan deliberately fixes only the one confirmed dead export. A follow-up can triage any additional findings the tightened config surfaces.
- After this lands, `bun run knip` becomes a meaningful backend dead-code gate again — keep it in the pre-commit hook (plan 001).
