# Plan 008: Prevent the fallback auth secret from ever signing real sessions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/lib/server/config/env.ts src/lib/server/config/env.unit.test.ts src/lib/server/auth.ts` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

`BETTER_AUTH_SECRET` falls back to a hardcoded constant (`"default-secret-for-development-only"`), and the requirement/length validation only runs when `NODE_ENV === "production"`. If a self-hoster ever starts the production server without `NODE_ENV=production` — running the built output directly, a PaaS that doesn't set it, or `bun run preview` exposed to a network — auth silently signs session cookies with a **publicly known constant**. For this single-user app, anyone who knows the constant (it's in the open-source repo) can forge a valid session and bypass authentication entirely. The official Docker/Fly/Render paths set `NODE_ENV=production`, so the risk is specifically the operator who deploys differently. The fix is to fail fast whenever a real secret is missing, instead of substituting a guessable default outside an explicit dev context.

## Current state

**`src/lib/server/config/env.ts`** — validation gated on `isProd` (around lines 56–79) and the fallback (around line 98):

```ts
const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";
...
// Validate BETTER_AUTH_SECRET
const authSecret = process.env.BETTER_AUTH_SECRET;
if (isProd) {
  if (!authSecret) {
    validationErrors.push({ variable: "BETTER_AUTH_SECRET", message: "...required in production" });
  } else if (authSecret.length < 32) {
    validationErrors.push({ variable: "BETTER_AUTH_SECRET", message: "...at least 32 characters long" });
  }
}
...
export const env = {
  DATABASE_URL: getDatabaseUrl(),
  BETTER_AUTH_SECRET: authSecret || "default-secret-for-development-only",  // <-- fallback
  ...
} as const;
```

`env.BETTER_AUTH_SECRET` flows into `createAuth` at `src/lib/server/auth.ts:25` (`secret: env.BETTER_AUTH_SECRET`).

The intent is: developers without a secret should still be able to run locally. The problem is the dev fallback is reachable in any non-`production` `NODE_ENV`, including misconfigured real deployments.

**Tests**: `src/lib/server/config/env.unit.test.ts` already exercises env validation — read it to match the existing test style and the `validateEnv()` helper.

## The fix

Make the fallback reachable ONLY in an explicit development context, and fail fast otherwise. Concretely:

- Keep a usable dev default ONLY when `NODE_ENV !== "production"` AND the process is clearly development (it already defaults `nodeEnv` to `"development"` when unset). The danger is that "unset NODE_ENV in prod" looks identical to "local dev". To close that, the safest minimal change is: **require a real `BETTER_AUTH_SECRET` (>=32 chars) unless `NODE_ENV === "development"` explicitly** — i.e. treat "unset / anything other than development" as needing a real secret.

Recommended logic:

```ts
const isDevExplicit = nodeEnv === "development";

// Require a real secret everywhere except explicit development.
if (!isDevExplicit) {
  if (!authSecret) {
    validationErrors.push({
      variable: "BETTER_AUTH_SECRET",
      message: "BETTER_AUTH_SECRET is required unless NODE_ENV=development",
    });
  } else if (authSecret.length < 32) {
    validationErrors.push({
      variable: "BETTER_AUTH_SECRET",
      message: "BETTER_AUTH_SECRET must be at least 32 characters long",
    });
  }
}
```

And only use the constant default when `isDevExplicit`:

```ts
BETTER_AUTH_SECRET: authSecret ?? (isDevExplicit ? "default-secret-for-development-only" : ""),
```

(With validation above, the empty-string branch is never reached at runtime because validation throws first; it just satisfies the type.)

Note: `NODE_ENV` defaults to `"development"` when unset (existing line `const nodeEnv = process.env.NODE_ENV || "development"`). This means a totally-unset environment still gets the dev default — that matches current dev ergonomics. The improvement is that any NON-development explicit value (e.g. `staging`, `test`, or anything that isn't literally `production` today) now also requires a real secret, closing the "prod without NODE_ENV=production" gap for the common PaaS case where `NODE_ENV` is set to something, just not `production`. Apply the SAME change to the `validateEnv()` helper so diagnostics agree.

If the team prefers strict-by-default (require a secret even when `NODE_ENV` is unset), that's a stronger option but breaks zero-config local dev; default to the recommended logic unless told otherwise.

## Commands you will need

| Purpose         | Command                    | Expected |
| --------------- | -------------------------- | -------- |
| Env unit tests  | `bun run test:unit -- env` | pass     |
| Typecheck       | `bun run check`            | exit 0   |
| Lint            | `vp check`                 | exit 0   |
| Full unit suite | `bun run test:unit`        | pass     |

## Scope

**In scope** (the only files you should modify):

- `src/lib/server/config/env.ts` — gate the fallback on explicit development; require a real secret otherwise (both the module-load validation and the `validateEnv()` helper)
- `src/lib/server/config/env.unit.test.ts` — add cases

**Out of scope** (do NOT touch):

- `src/lib/server/auth.ts` — it consumes `env.BETTER_AUTH_SECRET`; no change needed.
- `DATABASE_URL` validation logic.
- Deployment configs (`Dockerfile`, `fly.toml`, `compose.prod.yaml`) — they already set `NODE_ENV=production`; do not change them.

## Git workflow

- Branch: `advisor/008-harden-auth-secret`
- Commit message: `fix(security): require real BETTER_AUTH_SECRET outside explicit development`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Update the module-load validation

Replace the `if (isProd) {...}` secret-validation block with the `if (!isDevExplicit) {...}` logic from "The fix". Define `const isDevExplicit = nodeEnv === "development";` near the existing `isProd` line (keep `isProd` if other code uses it — check with `grep -n "isProd" src/lib/server/config/env.ts`).

**Verify**: `bun run check` → exit 0.

### Step 2: Gate the fallback default

Change the `env.BETTER_AUTH_SECRET` initializer so the constant default is only used when `isDevExplicit`.

**Verify**: `grep -n "default-secret-for-development-only" src/lib/server/config/env.ts` → still present but guarded by the dev check.

### Step 3: Mirror the change in `validateEnv()`

Update the `validateEnv()` helper's secret check to use the same `!isDevExplicit` condition so diagnostics match runtime behavior.

**Verify**: `grep -n "isProduction()\|isDevExplicit\|NODE_ENV" src/lib/server/config/env.ts` shows consistent gating in both the module body and `validateEnv()`.

### Step 4: Add tests

In `src/lib/server/config/env.unit.test.ts`, add cases using `validateEnv()` (it returns `{ valid, errors }` without throwing — see existing tests). Cover:

- `NODE_ENV=production`, no secret → `valid: false` with a `BETTER_AUTH_SECRET` error (existing behavior preserved).
- `NODE_ENV` set to a non-dev, non-prod value (e.g. `"staging"`), no secret → now `valid: false` (the new protection).
- `NODE_ENV=development`, no secret → `valid: true` (dev ergonomics preserved).
- `NODE_ENV=production`, short secret (<32) → `valid: false`.
- `NODE_ENV=production`, valid 32+ secret → `valid: true`.

Match how the existing tests set/reset `process.env` (look for `beforeEach`/`afterEach` restoring env).

**Verify**: `bun run test:unit -- env` → all pass.

### Step 5: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:unit` → pass.

## Test plan

- New `validateEnv()` cases (above) covering production/non-dev/dev × missing/short/valid secret.
- Model on existing `env.unit.test.ts` cases and its env save/restore pattern.
- Verification: `bun run test:unit -- env` passes including the new "non-dev requires secret" case.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The fallback constant is only assigned when `NODE_ENV === "development"`
- [ ] Both the module-load validation and `validateEnv()` require a real 32+ char secret when `NODE_ENV` is not explicit development
- [ ] New tests prove: non-dev without secret → invalid; dev without secret → valid; production short secret → invalid
- [ ] `bun run test:unit -- env` passes
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] Only `env.ts` and `env.unit.test.ts` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `env.ts` does not match the "Current state" excerpt (validation/fallback already changed).
- Other code depends on `env.BETTER_AUTH_SECRET` always being a non-empty string in a way the new gating breaks at typecheck (then keep the empty-string-with-validation approach, which throws before use).
- Existing env tests assume the old `isProd`-only behavior and now fail in a way that indicates a real behavior conflict (report rather than weakening them).
- The team's deployment sets `NODE_ENV` to something unexpected that this change would now reject — surface it before merging.

## Maintenance notes

- For the reviewer: the security property is "no real deployment can run on the hardcoded secret". Confirm the only path to the constant is explicit `NODE_ENV=development`.
- Consider a follow-up that also warns/refuses when binding a non-loopback host without a real secret, as defense-in-depth — explicitly deferred here to keep the change minimal.
- Never print the secret value in logs or errors; the existing `getEnvSummary()` masks it — keep it masked.
