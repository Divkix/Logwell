# Plan 007: Treat OTLP `timeUnixNano` of zero as "unset" instead of epoch 1970

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/lib/server/utils/otlp.ts src/lib/server/utils/otlp.unit.test.ts` — if either changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

When an OTLP exporter sends `timeUnixNano: "0"` or `0` (a non-conformant but real way some exporters represent "unset"), Logwell stores the log with `timestamp = 1970-01-01T00:00:00Z` — even when a valid `observedTimeUnixNano` is present that should have been used instead. The string `"0"` passes the uint64 validation, so it's treated as a real timestamp: it shadows the `observedTimeUnixNano` fallback, `new Date(0)` is not `NaN` so it's returned as-is, and the log lands at epoch 0. Such logs sort to the bottom of every view, fall outside all time-range and timeline/bucket queries, and become immediately eligible for retention deletion. The stored `timeUnixNano` column ("0") and the derived `timestamp` (1970) also disagree.

## Current state

**`src/lib/server/utils/otlp.ts`** — `parseUint64String` accepts `"0"` and `0` (around lines 86–103):

```ts
export function parseUint64String(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null; // "0" matches \d+
    return trimmed; // returns "0"
  }
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 // 0 passes
  ) {
    return Math.trunc(value).toString(); // returns "0"
  }
  return null;
}
```

`parseTimestamp` then prefers the non-null `"0"` over `observedTimeUnixNano` (around lines 127–143):

```ts
function parseTimestamp(timeUnixNano: string | null, observedTimeUnixNano: string | null): Date {
  const candidate = timeUnixNano ?? observedTimeUnixNano; // "0" wins over observed
  if (!candidate) {
    return new Date();
  }
  try {
    const nanos = BigInt(candidate);
    const millis = Number(nanos / 1000000n);
    const date = new Date(millis); // new Date(0) -> 1970, not NaN
    if (Number.isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  } catch {
    return new Date();
  }
}
```

`parseUint64String` is also used elsewhere in `otlp.ts` to populate the stored `timeUnixNano` / `observedTimeUnixNano` string columns (search the file for its call sites). The fix must NOT change how those raw nano string columns are stored for legitimate non-zero values — only how a _zero_ is treated when deriving the effective `timestamp` and when deciding "is this field set".

## Decision: where to fix

Fix at the **timestamp-derivation boundary**, not by globally rejecting `"0"` in `parseUint64String`. Rationale: `"0"` may be a legitimately-stored raw value for the `timeUnixNano` column in some payloads, and changing `parseUint64String` globally could have wider effects. The narrowest correct fix is to treat a zero nano value as "absent" specifically in the fallback chain that picks the effective timestamp.

Implement a small helper and use it in `parseTimestamp`:

```ts
function nonZeroNano(value: string | null): string | null {
  // Treat an explicit zero ("0", "00", ...) as unset so observedTime / now() win.
  if (value === null) return null;
  return /^0+$/.test(value) ? null : value;
}

function parseTimestamp(timeUnixNano: string | null, observedTimeUnixNano: string | null): Date {
  const candidate = nonZeroNano(timeUnixNano) ?? nonZeroNano(observedTimeUnixNano);
  if (!candidate) {
    return new Date();
  }
  // ... unchanged BigInt / Date logic
}
```

This makes a zero `timeUnixNano` fall through to `observedTimeUnixNano`, and a zero (or absent) on both fall through to `new Date()` (now) — the correct behavior for "unset".

## Commands you will need

| Purpose          | Command                            | Expected |
| ---------------- | ---------------------------------- | -------- |
| OTLP unit tests  | `bun run test:unit -- otlp`        | pass     |
| OTLP integration | `bun run test:integration -- otlp` | pass     |
| Typecheck        | `bun run check`                    | exit 0   |
| Lint             | `vp check`                         | exit 0   |

## Scope

**In scope** (the only files you should modify):

- `src/lib/server/utils/otlp.ts` — add `nonZeroNano` helper, use it in `parseTimestamp`
- `src/lib/server/utils/otlp.unit.test.ts` — add cases for zero-handling

**Out of scope** (do NOT touch):

- `parseUint64String`'s acceptance of `"0"` for the raw stored columns — do NOT globally reject zero there; the fix is localized to timestamp derivation.
- The simple-ingest path (`simple-ingest.ts`) — it uses ISO timestamps, not unix-nano; unaffected.
- The `log` schema or any migration.

## Git workflow

- Branch: `advisor/007-otlp-zero-timestamp`
- Commit message: `fix(otlp): treat zero timeUnixNano as unset so observedTime/now win`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the `nonZeroNano` helper and apply it in `parseTimestamp`

Add the helper (above `parseTimestamp`) and update the `candidate` derivation as shown in the "Decision" section. Leave the `BigInt`/`Date`/`NaN` logic unchanged.

**Verify**: `bun run check` → exit 0.

### Step 2: Add unit tests for zero handling

In `src/lib/server/utils/otlp.unit.test.ts`, add cases. Find the existing `parseTimestamp` / timestamp tests (search the file for `timeUnixNano` or `parseTimestamp`) and model new cases on them. Cover:

- `timeUnixNano = "0"`, `observedTimeUnixNano = <valid nano>` → derived timestamp equals the observed time (NOT 1970).
- `timeUnixNano = "0"`, `observedTimeUnixNano = null` → derived timestamp is "now" (assert it's within a few seconds of `Date.now()`, not epoch 0).
- `timeUnixNano = 0` (number) → same as `"0"` (only if the numeric form reaches `parseTimestamp`; if the code converts via `parseUint64String` first, `0` becomes `"0"` — verify the path).
- Regression: a valid non-zero `timeUnixNano` still produces the correct date (existing behavior preserved).

If `parseTimestamp` is not exported, test through the public `normalizeOtlpLogsRequest` by constructing a minimal OTLP payload with a zero `timeUnixNano` and a valid `observedTimeUnixNano`, then assert the resulting record's `timestamp`. Check how the existing tests exercise it and follow that pattern.

**Verify**: `bun run test:unit -- otlp` → new cases pass; `bun run test:integration -- otlp` → pass.

### Step 3: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:unit -- otlp && bun run test:integration -- otlp` → pass.

## Test plan

- New unit/integration cases (above) covering zero `timeUnixNano` with and without a valid `observedTimeUnixNano`, plus a non-zero regression case.
- Model on existing `otlp.unit.test.ts` timestamp tests.
- Verification: `bun run test:unit -- otlp` and `bun run test:integration -- otlp` pass with the new cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/lib/server/utils/otlp.ts` contains a helper that maps an all-zero nano string to `null` in the timestamp fallback
- [ ] `grep -n "nonZeroNano\|/\\^0" src/lib/server/utils/otlp.ts` shows the zero-handling in `parseTimestamp`
- [ ] New tests assert: zero `timeUnixNano` + valid `observedTimeUnixNano` → observed time; zero + none → ~now; non-zero → unchanged
- [ ] `bun run test:unit -- otlp` and `bun run test:integration -- otlp` pass
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] Only `otlp.ts` and `otlp.unit.test.ts` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `parseTimestamp` or `parseUint64String` do not match the "Current state" excerpts (logic drifted).
- A zero `timeUnixNano` is found to be load-bearing for some legitimate stored-column behavior such that fixing `parseTimestamp` breaks an existing test — report the conflict.
- The fix would require changing `parseUint64String` globally (it should not — keep the fix in the timestamp boundary).

## Maintenance notes

- For the reviewer: confirm the raw `timeUnixNano`/`observedTimeUnixNano` string columns still store legitimate non-zero values unchanged; only the _derived_ `timestamp` and the fallback selection changed.
- This addresses only the zero-shadowing bug. The related timeline/timeseries final-bucket off-by-one (audit BUG-03/04) is a separate, lower-priority item not covered here.
