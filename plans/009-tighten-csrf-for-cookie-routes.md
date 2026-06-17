# Plan 009: Require Origin/Referer for cookie-authenticated state changes (CSRF hardening)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/lib/server/utils/csrf.ts tests/integration/utils/csrf.unit.test.ts` — if either changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

`checkCsrfOrigin` allows any state-changing request that sends **neither** `Origin` nor `Referer`. For the cookie-authenticated routes (project create/update/delete, regenerate, the SSE stream POSTs), this is a documented soft spot: a cross-origin attacker who can get a browser to send a header-less state-changing request would pass the check, leaving only the session cookie's `SameSite=Lax` default as protection. Modern browsers do send `Origin` on cross-origin POST/PATCH/DELETE, so practical exposure is small — but "allow when both headers are absent" is exactly the case worth closing for ambient-cookie routes. The leniency must be preserved for the `/v1/*` ingest routes, which are bearer-API-key authenticated (no ambient cookie, so not CSRF-able) and are legitimately called by SDKs/curl that omit these headers.

## Current state

**`src/lib/server/utils/csrf.ts`** — the allow-on-absence policy (around lines 30–52):

```ts
export function checkCsrfOrigin(event: RequestEvent): Response | null {
  const method = event.request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const expectedOrigin = event.url.origin;

  const origin = event.request.headers.get("Origin");
  if (origin && origin !== expectedOrigin) {
    return new Response(JSON.stringify({ error: "csrf_error", message: "Invalid Origin header" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const referer = event.request.headers.get("Referer");
  if (referer && !referer.startsWith(`${expectedOrigin}/`)) {
    return new Response(
      JSON.stringify({ error: "csrf_error", message: "Invalid Referer header" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return null; // <-- reached when BOTH headers are absent: currently allowed
}
```

**Callers** (all cookie-authenticated routes; confirm with `grep -rn "checkCsrfOrigin" src/routes`):

- `src/routes/api/projects/+server.ts` (POST create)
- `src/routes/api/projects/[id]/+server.ts` (PATCH, DELETE)
- `src/routes/api/projects/[id]/regenerate/+server.ts` (POST)
- `src/routes/api/projects/[id]/logs/stream/+server.ts` (POST)
- `src/routes/api/projects/[id]/incidents/stream/+server.ts` (POST)

Crucially, `/v1/ingest` and `/v1/logs` do **NOT** call `checkCsrfOrigin` (they use `validateApiKey`). So tightening `checkCsrfOrigin` does not affect SDK/curl ingest traffic — only the cookie routes that already call it.

**Existing tests**: `tests/integration/utils/csrf.unit.test.ts` includes a test that explicitly asserts the current allow-on-absence behavior:

```ts
it("allows POST with no Origin and no Referer (intentional policy for API clients)", () => {
  const event = makeEvent("POST", "http://localhost/api/projects");
  expect(checkCsrfOrigin(event)).toBeNull();
});
```

This test encodes the OLD policy and must be updated (see Steps).

## The fix

Because every current caller of `checkCsrfOrigin` is a cookie-authenticated route, the simplest correct change is to **reject state-changing requests that have neither `Origin` nor `Referer`** in `checkCsrfOrigin`. The bearer `/v1/*` routes don't call this function, so they're unaffected and keep accepting header-less requests.

Add, after the two existing header checks, a final guard:

```ts
// Neither Origin nor Referer present on a state-changing request.
// Every caller of this function is cookie-authenticated, so a header-less
// cross-origin request must not be trusted. (Bearer /v1 ingest routes do not
// call this function and are unaffected.)
if (!origin && !referer) {
  return new Response(
    JSON.stringify({ error: "csrf_error", message: "Missing Origin and Referer headers" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

return null;
```

## Commands you will need

| Purpose                     | Command                                    | Expected                            |
| --------------------------- | ------------------------------------------ | ----------------------------------- |
| CSRF unit tests             | `bun run test:integration -- csrf`         | pass                                |
| Confirm callers             | `grep -rn "checkCsrfOrigin" src/routes`    | only the 5 cookie routes            |
| Confirm /v1 does NOT use it | `grep -rn "checkCsrfOrigin" src/routes/v1` | no matches                          |
| Typecheck                   | `bun run check`                            | exit 0                              |
| Lint                        | `vp check`                                 | exit 0                              |
| E2E (UI still works)        | `bun run test:e2e`                         | pass (needs `docker compose up -d`) |

## Scope

**In scope** (the only files you should modify):

- `src/lib/server/utils/csrf.ts` — add the both-headers-absent rejection
- `tests/integration/utils/csrf.unit.test.ts` — update the now-obsolete "allows … no Origin and no Referer" test and add a rejection case

**Out of scope** (do NOT touch):

- The `/v1/ingest` and `/v1/logs` routes — they must NOT start calling `checkCsrfOrigin`. SDK/curl ingest legitimately omits these headers.
- The route handlers that call `checkCsrfOrigin` — no change needed; they already short-circuit on its non-null return.
- better-auth's own `/api/auth/*` CSRF handling — leave to better-auth.

## Git workflow

- Branch: `advisor/009-csrf-tighten`
- Commit message: `fix(security): reject cookie-route state changes lacking Origin and Referer`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: First confirm the safety precondition

Run `grep -rn "checkCsrfOrigin" src/routes`. Confirm EVERY caller is a cookie-authenticated route and that NOTHING under `src/routes/v1/` calls it. This is the precondition that makes rejecting header-less requests safe.

**Verify**: the caller list matches the 5 routes in "Current state"; `grep -rn "checkCsrfOrigin" src/routes/v1` is empty. If a `/v1` route DOES call it, STOP (see STOP conditions).

### Step 2: Add the both-headers-absent rejection

Insert the guard from "The fix" just before the final `return null;` in `checkCsrfOrigin`.

**Verify**: `bun run check` → exit 0.

### Step 3: Update the CSRF tests

In `tests/integration/utils/csrf.unit.test.ts`:

- Change the existing `it("allows POST with no Origin and no Referer ...")` test to assert rejection now: it should expect a non-null `Response` with `status` 403 and body `error === "csrf_error"`. Rename it to reflect the new policy, e.g. `"rejects POST with neither Origin nor Referer (cookie routes)"`.
- Keep all other existing cases (matching Origin allowed, mismatched Origin/Referer rejected, safe methods allowed) — they remain valid.
- Add a case confirming a request WITH a matching `Origin` and no `Referer` is still allowed (the common legitimate browser case): `Origin: http://localhost` → `null`.

**Verify**: `bun run test:integration -- csrf` → all pass.

### Step 4: Confirm the UI still works end-to-end

The web UI's fetch calls are same-origin and send `Origin`/`Referer`, so they remain allowed. Run the E2E suite (requires Postgres via `docker compose up -d`) to confirm project create/update/delete/regenerate and the SSE streams still work from the browser.

**Verify**: `bun run test:e2e` → pass. If Docker/Postgres is unavailable in this environment, note it and rely on the integration tests + manual reasoning (the UI always sends Origin same-origin).

## Test plan

- Update the obsolete "allows no Origin/Referer" test to assert 403.
- Add "matching Origin, no Referer → allowed" to lock in the legitimate browser path.
- Keep all existing matching/mismatching cases.
- Verification: `bun run test:integration -- csrf` passes; `bun run test:e2e` passes (UI flows unaffected).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `checkCsrfOrigin` returns a 403 `csrf_error` when both `Origin` and `Referer` are absent on POST/PATCH/DELETE
- [ ] `grep -rn "checkCsrfOrigin" src/routes/v1` returns no matches (bearer routes unaffected)
- [ ] The old "allows … no Origin and no Referer" test is updated to assert rejection
- [ ] A "matching Origin, no Referer → allowed" test exists and passes
- [ ] `bun run test:integration -- csrf` passes
- [ ] `bun run check` exits 0; `vp check` exits 0
- [ ] `bun run test:e2e` passes (or documented as environment-blocked)
- [ ] Only `csrf.ts` and `csrf.unit.test.ts` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `checkCsrfOrigin` does not match the "Current state" excerpt.
- ANY route under `src/routes/v1/` calls `checkCsrfOrigin` — then rejecting header-less requests would break SDK/curl ingest. STOP and report; the fix would need to be per-route, not in the shared helper.
- E2E tests fail in a way suggesting the UI sometimes omits both headers (then the same-origin assumption is wrong — report the failing flow).
- Removing the lenient path breaks better-auth's own flows (it shouldn't — better-auth routes don't call this helper, but verify).

## Maintenance notes

- For the reviewer: the safety of this change rests entirely on "only cookie routes call `checkCsrfOrigin`". If a future route adds bearer auth and reuses this helper, this policy must be revisited (make the leniency conditional on auth type, or skip the helper for bearer routes).
- The file's own comment block currently documents the allow-on-absence policy — update that comment to match the new behavior.
- This is defense-in-depth; the session cookie's `SameSite` attribute remains the first line of defense.
