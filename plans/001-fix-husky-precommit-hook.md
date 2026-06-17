# Plan 001: Restore the husky pre-commit hook so `vp check && knip` actually runs locally

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- package.json .husky` — if either changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

`AGENTS.md` documents a pre-commit checklist (`vp check && bun run knip`) and the repo ships a `.husky/` directory, implying these checks run automatically before every commit. They do **not**. `husky` is not a dependency, the `prepare` script never installs it, and there is no `.husky/pre-commit` file — only husky's internal stubs in `.husky/_/`. So lint/format/typecheck/dead-code regressions reach CI (or `main`) instead of being caught locally. This restores the intended local quality gate. CI already runs the same checks, so this is a faster feedback loop, not a new gate.

## Current state

- `package.json:10` — the `prepare` script does NOT install husky:
  ```json
  "prepare": "vp config && svelte-kit sync || echo ''",
  ```
- `husky` appears nowhere in `package.json` (not in `devDependencies`). Confirm: `grep -n husky package.json` returns only the `prepare` line if anything.
- `.husky/` contains only `.husky/_/` (husky's internal runner stubs). There is **no** `.husky/pre-commit` file at the top level. The stub `.husky/_/pre-commit` is 39 bytes and is husky's auto-generated loader, not a project hook.
- The documented checklist lives in `AGENTS.md` under "**Pre-commit checklist:** `vp check && bun run knip`".
- Package manager is **bun** (`packageManager: bun@1.3.14`); always use `bun run`, never `npm`.

Note on `prepare`: `vp config` is part of the vite-plus toolchain setup and must be preserved. The `svelte-kit sync` call generates `./$types`. Both must keep running.

## Commands you will need

| Purpose                | Command                     | Expected on success                    |
| ---------------------- | --------------------------- | -------------------------------------- |
| Add husky dev dep      | `bun add -d husky`          | exit 0, husky added to devDependencies |
| Run prepare manually   | `bun run prepare`           | exit 0; husky initializes git hooks    |
| Lint/format/typecheck  | `vp check`                  | exit 0                                 |
| Dead-code check        | `bun run knip`              | exit 0                                 |
| Inspect git hooks path | `git config core.hooksPath` | prints `.husky/_` after husky init     |

## Scope

**In scope** (the only files you should modify/create):

- `package.json` — add `husky` devDependency, update `prepare` script
- `.husky/pre-commit` (create) — the actual hook
- `.gitignore` — only if needed to ensure `.husky/_/` stays ignored (husky manages this itself; verify, don't fight it)

**Out of scope** (do NOT touch):

- `AGENTS.md` — the checklist text there is already correct; don't edit it.
- Any CI workflow under `.github/workflows/` — CI already enforces these checks; do not change it.
- The contents of `.husky/_/` — husky regenerates these; never hand-edit.

## Git workflow

- Branch: `advisor/001-husky-precommit`
- Commit message style: conventional commits (repo uses `feat:`/`fix:`/`docs:`/`deps:`/`docker:` prefixes — see `git log --oneline -5`). Use `build: restore husky pre-commit hook`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add husky as a dev dependency

Run `bun add -d husky`. This is the current major version of husky (v9+), which uses the simplified hook format (no `husky.sh` sourcing in the hook file).

**Verify**: `grep -n '"husky"' package.json` → shows husky in `devDependencies`.

### Step 2: Wire husky into the `prepare` script

Husky v9 is initialized by running `husky` (no `install` subcommand). Preserve the existing `vp config && svelte-kit sync` work. Update `package.json:10` to:

```json
"prepare": "husky && vp config && svelte-kit sync || echo ''",
```

Rationale for ordering: `husky` first sets `core.hooksPath`; the `|| echo ''` tail is preserved so a CI environment without a `.git` dir (e.g. installing from a tarball) does not fail `prepare` — husky already no-ops gracefully outside a git repo, but keeping the guard matches the repo's existing intent.

**Verify**: `bun run prepare` → exit 0. Then `git config core.hooksPath` → prints `.husky/_`.

### Step 3: Create the pre-commit hook

Create `.husky/pre-commit` with exactly this content (husky v9 format — no shebang boilerplate needed, but a shebang is harmless and clearer):

```sh
vp check && bun run knip
```

Make sure the file is executable: `chmod +x .husky/pre-commit`.

**Verify**: `cat .husky/pre-commit` shows the command; `test -x .husky/pre-commit && echo OK` → `OK`.

### Step 4: Prove the hook fires

Stage a trivial whitespace-only change to a throwaway scratch file and attempt a commit in a dry manner, OR run the hook directly to confirm it executes:

```sh
sh .husky/pre-commit
```

**Verify**: the command runs `vp check` then `bun run knip` and exits 0 on the clean tree. If `vp check` or `knip` report pre-existing issues unrelated to this plan, see STOP conditions.

## Test plan

No unit/integration tests are added (this is tooling config). Verification is behavioral:

- `bun run prepare` exits 0 and sets `core.hooksPath` to `.husky/_`.
- `sh .husky/pre-commit` runs both checks and exits 0 on the current clean tree.
- Optionally, confirm a deliberately malformed staged file causes the hook to fail (then revert it) — only if quick; not required.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -q '"husky"' package.json` (husky is a devDependency)
- [ ] `package.json` `prepare` script contains `husky` AND still contains `vp config` and `svelte-kit sync`
- [ ] `.husky/pre-commit` exists, is executable, and contains `vp check && bun run knip`
- [ ] `git config core.hooksPath` returns `.husky/_` after `bun run prepare`
- [ ] `vp check` exits 0 and `bun run knip` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `package.json:10` does not match the "Current state" excerpt (the repo has drifted, or husky was already wired).
- `vp check` or `bun run knip` report **pre-existing** failures on the unmodified tree. Do NOT fix unrelated lint/dead-code issues to make the hook pass — report them; they are out of scope for this plan.
- `bun add -d husky` pulls a husky major version older than 9 (the hook format differs). Report the resolved version.
- Husky requires changes to files outside the in-scope list.

## Maintenance notes

- For the reviewer: confirm `.husky/pre-commit` was committed (husky ignores `.husky/_/` but the top-level hook must be tracked). Confirm `prepare` still runs `vp config` + `svelte-kit sync`.
- Future: if the team finds the hook too slow, the usual mitigation is to scope `vp check` to staged files via a staged-files runner — explicitly deferred here to keep the gate identical to the documented checklist and to CI.
- This plan only restores local enforcement; CI in `.github/workflows/ci.yml` remains the authoritative backstop.
