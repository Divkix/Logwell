# Plan 016: Unify `(app)` page-loader project-ownership checks and database access through the existing seams

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/'(app)' src/lib/server/utils/project-guard.ts src/lib/server/db/db.ts` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (auth-adjacent; the ownership 404 behavior MUST be preserved exactly)
- **Depends on**: best landed AFTER plan 015 (which already edits two of these loaders to dedup helpers — sequence to avoid churn). Independent of the perf plans.
- **Category**: tech-debt / consistency
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

The repo has TWO clean seams for authenticated project routes:

- **Ownership**: `requireProjectOwnership(event, projectId)` (`project-guard.ts`) — auth + ownership in one call, returning a 404 `Response` for non-owners (deliberately hiding existence).
- **DB access**: `getDbClient(event.locals)` (`db.ts`) — returns the injected test DB from `locals.db` or the production singleton, enabling integration tests to inject PGlite.

The **API routes use both seams**. The **`(app)` page loaders use neither** — they hand-roll the ownership query (`requireAuth` + `and(eq(project.id), eq(project.ownerId, user.id))`) and reach for the DB three different ways. This causes two concrete problems:

1. **The test seam is bypassed.** Loaders call `await import("$lib/server/db")` or top-level `import { db }`, which ignore `locals.db`. Integration tests that inject a PGlite DB into `locals` cannot exercise these loaders against the test database — so the page loaders are effectively untestable via the same harness the API routes use.
2. **Ownership logic is copy-pasted 4×** with the exact `ownerId` equality each time. A change to the ownership rule (e.g. team sharing) must be made in 5+ places and is easy to miss — an authorization-consistency hazard.

This plan routes the page loaders through the same seams as the API, without changing any user-visible behavior (still a 404 error page for non-owners).

## Current state

**Three DB-access patterns across `(app)`** (from `grep`):

- Top-level singleton import: `src/routes/(app)/+page.server.ts:2` → `import { db } from "$lib/server/db";`
- Dynamic singleton import (most loaders): `await import("$lib/server/db")` in `projects/[id]/+page.server.ts:58`, `.../stats/+page.server.ts:30`, `.../settings/+page.server.ts:12`, `.../incidents/+page.server.ts:27`
- The seam (NOT used by any loader, used by all API routes): `getDbClient(event.locals)`

**Hand-rolled ownership (4 project loaders)** — identical shape, e.g. `projects/[id]/+page.server.ts:56-67`:

```ts
const { user } = await requireAuth(event);
const { db } = await import("$lib/server/db");
const projectId = event.params.id;
const [projectData] = await db
  .select()
  .from(project)
  .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));
if (!projectData) {
  throw error(404, { message: "Project not found" });
}
```

Same block in `stats/`, `settings/`, `incidents/` loaders.

**The behavioral nuance** (critical): page loaders use `throw error(404, ...)` from `@sveltejs/kit` (renders the SvelteKit error PAGE). `requireProjectOwnership` returns a JSON `Response` (correct for API/`fetch` clients, WRONG for a page loader — returning a `Response` from a loader does not render the error page the same way). So you CANNOT drop `requireProjectOwnership` into a loader unchanged. You need a loader-flavored ownership helper that `throw`s a SvelteKit error.

**The root `(app)/+page.server.ts`** lists the user's projects (`where(eq(project.ownerId, user.id))`) — that's a list query, not a single-project ownership check; it just needs the DB seam, not the ownership helper.

## The plan

1. Add a **page-loader ownership helper** alongside `requireProjectOwnership` that performs the same auth+ownership query but `throw`s `error(404, ...)` instead of returning a JSON `Response`. Reuse the SAME ownership SQL so the two helpers can never drift.
2. Migrate the 4 project loaders to that helper.
3. Migrate ALL `(app)` loaders' DB access to `getDbClient(event.locals)` (including the root list loader) so the test-injection seam works everywhere.

### Helper design (avoid drift between the two ownership helpers)

In `src/lib/server/utils/project-guard.ts`, extract the shared query and add a loader variant. Sketch:

```ts
async function findOwnedProject(event: RequestEvent, projectId: string) {
  const { user, session } = await requireAuth(event);
  const db = await getDbClient(event.locals);
  const [projectData] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));
  return { projectData, user, session };
}

// Existing API helper — now delegates to findOwnedProject (returns JSON 404 Response)
export async function requireProjectOwnership(
  event,
  projectId,
): Promise<AuthorizedProject | Response> {
  const { projectData, user, session } = await findOwnedProject(event, projectId);
  if (!projectData)
    return json({ error: "not_found", message: "Project not found" }, { status: 404 });
  return { project: projectData, user, session };
}

// New loader helper — throws a SvelteKit error PAGE (matches current loader behavior)
export async function requireProjectOwnershipPage(event, projectId): Promise<AuthorizedProject> {
  const { projectData, user, session } = await findOwnedProject(event, projectId);
  if (!projectData) throw error(404, { message: "Project not found" });
  return { project: projectData, user, session };
}
```

`requireAuth` already throws a redirect to `/login` for unauthenticated requests in both paths — unchanged. Note `requireProjectOwnership` now goes through `getDbClient` exactly as before (it already did), so API behavior is identical.

## Commands you will need

| Purpose                   | Command                                     | Expected              |
| ------------------------- | ------------------------------------------- | --------------------- |
| Project-guard tests       | `bun run test:integration -- project-guard` | pass                  |
| Page-loader integration   | `bun run test:integration`                  | pass                  |
| E2E (pages render + 404s) | `bun run test:e2e`                          | pass (needs Postgres) |
| Typecheck                 | `bun run check`                             | exit 0                |
| Lint                      | `vp check`                                  | exit 0                |
| Dead-code                 | `bun run knip`                              | no new unused         |

## Scope

**In scope** (modify):

- `src/lib/server/utils/project-guard.ts` — extract `findOwnedProject`, add `requireProjectOwnershipPage`
- `src/routes/(app)/projects/[id]/+page.server.ts` — use the page helper + drop hand-rolled ownership; DB via the helper's return / `getDbClient`
- `src/routes/(app)/projects/[id]/stats/+page.server.ts` — same
- `src/routes/(app)/projects/[id]/settings/+page.server.ts` — same
- `src/routes/(app)/projects/[id]/incidents/+page.server.ts` — same
- `src/routes/(app)/+page.server.ts` — switch DB access to `getDbClient(event.locals)` (it's a list loader; no ownership helper needed)
- `src/routes/(app)/+layout.server.ts` — only if it does DB access (it currently just `requireAuth`; leave unless it touches the DB)

**Out of scope** (do NOT touch):

- The API routes — they already use both seams correctly.
- The ownership RULE itself (still `ownerId === user.id`, still 404 for non-owners).
- `requireAuth` / better-auth wiring.
- The query LOGIC inside each loader (filters, pagination, counts) — only the auth+DB plumbing changes. (Note plan 015 may already have touched the filter helpers in two of these files; rebase around it.)

## Git workflow

- Branch: `advisor/016-unify-loader-seams`
- Commit message: `refactor(app): route page loaders through requireProjectOwnership and getDbClient seams`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the loader ownership helper

In `project-guard.ts`, add `error` to the `@sveltejs/kit` import, extract `findOwnedProject`, refactor `requireProjectOwnership` to delegate to it (NO behavior change — still returns JSON 404), and add `requireProjectOwnershipPage` that throws `error(404, { message: "Project not found" })`.

**Verify**: `bun run check` → 0; existing API integration tests that hit `requireProjectOwnership` (e.g. logs/incidents endpoints) still pass — `bun run test:integration -- project-guard` and `-- logs`.

### Step 2: Migrate the 4 project loaders

In each of the four `projects/[id]/**/+page.server.ts`, replace the `requireAuth` + dynamic-import + hand-rolled ownership block with:

```ts
const { project: projectData, user } = await requireProjectOwnershipPage(event, event.params.id);
const db = await getDbClient(event.locals);
```

(If the loader needs `user.id` later, keep `user`. If it needs the DB for further queries, get it via `getDbClient(event.locals)`.) Remove the now-unused `requireAuth`, `project` schema import (if no longer referenced), and `and`/`eq` imports IF they become unused. Keep `error` import only if still used elsewhere in the file.

The returned `projectData` is the full `Project` row — exactly what the hand-rolled query returned — so downstream field access (`.name`, `.apiKeyHash`, `.retentionDays`, etc.) is unchanged.

**Verify** after EACH file: `bun run check` → 0. Then `bun run test:integration` for the relevant suite.

### Step 3: Migrate DB access in the root list loader

In `src/routes/(app)/+page.server.ts`, replace top-level `import { db }` usage with `const db = await getDbClient(event.locals);` inside the loader. This is a list query (`where(eq(project.ownerId, user.id))`) — keep `requireAuth` for the user, just swap the DB source so test injection works.

**Verify**: `bun run check` → 0.

### Step 4: Confirm the 404 behavior is byte-identical

For a project that exists but is owned by ANOTHER user, each migrated loader must STILL render the 404 error page (not a JSON blob, not a 500). This is the security-relevant invariant (hide existence from non-owners). Confirm via E2E or a focused integration test that loads a page for a non-owned project id and asserts a 404.

**Verify**: `bun run test:e2e` (the page-level 404 flows) → pass, or a focused integration test asserting the loader throws a 404 error. If E2E is environment-blocked, write the integration assertion.

### Step 5: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run knip` → no new unused exports (the new helper IS used; old imports removed); `bun run test` → pass.

## Test plan

- API ownership behavior unchanged: existing `requireProjectOwnership` tests + logs/incidents endpoint tests pass (Step 1 refactor is behavior-preserving).
- Page loaders now testable via `locals.db` injection: add/confirm at least one integration test that injects a PGlite DB into `locals`, loads a project page, and gets data back — proving the seam works (previously impossible).
- Non-owner → 404 page for every migrated loader (Step 4).
- knip confirms no orphaned helper/imports.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `requireProjectOwnershipPage` exists in `project-guard.ts` and `requireProjectOwnership` delegates to a shared `findOwnedProject` (single ownership query)
- [ ] `grep -rn "ownerId, user.id\|eq(project.ownerId" src/routes/(app)` shows the hand-rolled ownership query is GONE from the 4 project loaders (the only remaining `ownerId` filter is the root list loader's list query)
- [ ] `grep -rn "await import(\"\$lib/server/db\")\|import { db } from \"\$lib/server/db\"" src/routes/(app)` returns NOTHING — all `(app)` loaders use `getDbClient(event.locals)`
- [ ] Non-owner access to each migrated page still yields a 404 error PAGE (not JSON, not 500)
- [ ] At least one integration test exercises a page loader via injected `locals.db`
- [ ] `bun run test` passes; `bun run check`, `vp check` exit 0; `bun run knip` no new unused
- [ ] Only the in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `requireProjectOwnership`, `getDbClient`, or the loaders don't match the "Current state" excerpts.
- Swapping to `requireProjectOwnershipPage` changes the non-owner response from a rendered 404 page to anything else (the `throw error` vs `return Response` distinction is the whole point — get this exactly right).
- A loader needs `session` or a field the helper doesn't return — extend the helper's return type rather than reverting.
- Removing `await import("$lib/server/db")` breaks a circular-import avoidance the dynamic import was deliberately working around (the API routes use `getDbClient` fine, so this is unlikely — but if a loader fails to start, report the import error).
- Plan 015 has NOT landed and the filter-helper code in these files differs from what 015 assumes (coordinate sequencing).

## Maintenance notes

- For the reviewer: the security-relevant invariant is "non-owner sees 404, existence hidden". Verify that for every migrated loader. The refactor is otherwise mechanical.
- After this, there is ONE ownership query (`findOwnedProject`) behind two thin wrappers (API → JSON 404, page → error-page 404). A future change to the ownership rule (team sharing, org scoping) happens in one place.
- All `(app)` loaders now honor `locals.db`, so they're testable with the PGlite harness like the API routes — consider backfilling loader tests over time (not required by this plan).
- This plan deliberately does NOT change the API's JSON-404 contract; only the page loaders are unified onto the seams.
