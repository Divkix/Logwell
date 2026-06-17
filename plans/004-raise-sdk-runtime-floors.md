# Plan 004: Raise SDK runtime floors off EOL Node 18 / Python 3.9

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- sdks/typescript/package.json sdks/python/pyproject.toml` — if either changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: migration (dependencies)
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

The published TypeScript SDK advertises `engines.node >=18.0.0` and the Python SDK floors on `requires-python >=3.9` (with mypy/ruff also targeting 3.9). Node 18 reached end-of-life (April 2025) and Python 3.9 reached EOL (October 2025). Advertising EOL runtimes signals support the project can't security-back, and the `py39` tool targets suppress modern-Python lint/type improvements. Raising the floors only drops already-unsupported runtimes; both are semver-minor changes for the published packages.

## Current state

**`sdks/typescript/package.json`** (near the end):

```json
"engines": {
  "node": ">=18.0.0"
}
```

**`sdks/python/pyproject.toml`**:

```toml
[project]
requires-python = ">=3.9"
classifiers = [
  ...
  "Programming Language :: Python :: 3.9",
  "Programming Language :: Python :: 3.10",
  ...
]

[tool.mypy]
python_version = "3.9"

[tool.ruff]
target-version = "py39"
```

SDK toolchains (from `AGENTS.md`):

- TypeScript SDK: tsup + Vitest + vite-plus. Test from repo root: `bun run sdk:test`. From `sdks/typescript/`: `bun run check` (tsc), `bun run test`, `bun run build`.
- Python SDK: hatchling + pytest + ruff + mypy. From `sdks/python/`: `uv venv && source .venv/bin/activate && uv pip install -e ".[dev]"`, then `pytest`, `ruff check .`, `mypy src/`.

## Commands you will need

| Purpose      | Command (run from the SDK dir noted)                                                   | Expected |
| ------------ | -------------------------------------------------------------------------------------- | -------- |
| TS typecheck | `cd sdks/typescript && bun run check`                                                  | exit 0   |
| TS tests     | `cd sdks/typescript && bun run test`                                                   | pass     |
| TS build     | `cd sdks/typescript && bun run build`                                                  | exit 0   |
| Py setup     | `cd sdks/python && uv venv && source .venv/bin/activate && uv pip install -e ".[dev]"` | installs |
| Py lint      | `cd sdks/python && ruff check .`                                                       | exit 0   |
| Py types     | `cd sdks/python && mypy src/`                                                          | exit 0   |
| Py tests     | `cd sdks/python && pytest`                                                             | pass     |

## Scope

**In scope** (the only files you should modify):

- `sdks/typescript/package.json` — bump `engines.node`
- `sdks/python/pyproject.toml` — bump `requires-python`, drop the 3.9 classifier, bump mypy/ruff targets

**Out of scope** (do NOT touch):

- SDK source code under `sdks/typescript/src/` or `sdks/python/src/`. Do NOT modernize syntax to use newer-runtime features in this plan — this is a manifest/config change only. If ruff's `UP` rules now flag code after the target bump, see STOP conditions.
- The Go SDK (`sdks/go/`) — its `go 1.25` directive is current; no change.
- SDK version numbers — do not bump the package `version` field; release tagging is a separate manual process (see `AGENTS.md` Release Process).
- The root app's Node/Bun versions.

## Git workflow

- Branch: `advisor/004-sdk-runtime-floors`
- Commit message: `deps(sdks): raise runtime floors off EOL Node 18 / Python 3.9`
- Do NOT push, tag, or publish. SDK releases are tag-triggered and manual.

## Steps

### Step 1: Bump the TypeScript SDK Node floor

In `sdks/typescript/package.json`, change `engines.node` from `">=18.0.0"` to `">=20.0.0"` (Node 20 is the current LTS floor; use `>=20` unless the team wants `>=22`).

**Verify**: `cd sdks/typescript && bun run check && bun run test && bun run build` → all exit 0 / pass. The build must still emit CJS + ESM + types.

### Step 2: Bump the Python SDK floor and tool targets

In `sdks/python/pyproject.toml`:

- `requires-python = ">=3.9"` → `">=3.10"`
- Remove the `"Programming Language :: Python :: 3.9"` classifier line (keep 3.10–3.13).
- `[tool.mypy] python_version = "3.9"` → `"3.10"`
- `[tool.ruff] target-version = "py39"` → `"py310"`

**Verify**: `cd sdks/python && uv venv && source .venv/bin/activate && uv pip install -e ".[dev]" && ruff check . && mypy src/ && pytest` → all clean/pass.

### Step 3: Confirm no source changes were required

The target bumps may make ruff's `UP` (pyupgrade) rules suggest modernizations (e.g. `Optional[X]` → `X | None`). For THIS plan, the source must remain unchanged and still pass. If `ruff check .` now reports `UP` violations, that is a follow-up, not part of this plan — see STOP conditions.

**Verify**: `cd sdks/python && git diff --name-only src/` → empty (no source files changed).

## Test plan

No new tests. Existing SDK suites must still pass at the raised floors:

- TS: `bun run check`, `bun run test`, `bun run build` all green.
- Python: `ruff check .`, `mypy src/`, `pytest` all green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -q '">=20' sdks/typescript/package.json` (or `>=22`) and no `>=18` remains in `engines`
- [ ] `grep -q 'requires-python = ">=3.10"' sdks/python/pyproject.toml`
- [ ] `grep -c "Python :: 3.9" sdks/python/pyproject.toml` returns 0
- [ ] `grep -q 'python_version = "3.10"' sdks/python/pyproject.toml` AND `grep -q 'target-version = "py310"' sdks/python/pyproject.toml`
- [ ] TS SDK: `bun run check && bun run test && bun run build` succeed
- [ ] Python SDK: `ruff check . && mypy src/ && pytest` succeed
- [ ] No SDK source files modified (`git diff --name-only sdks/*/src` empty)
- [ ] Only the two manifest files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Either manifest does not match the "Current state" excerpt (already bumped or changed).
- After bumping the Python target, `ruff check .` reports `UP`/`SIM` violations on existing source — report them as a follow-up modernization task; do NOT modify source in this plan.
- Any existing SDK test fails at the raised floor (an incompatibility surfaced — report it).
- The Python dev environment can't be created (`uv` unavailable) — report; do not fall back to a global install.

## Maintenance notes

- For the reviewer: confirm `version` fields were NOT bumped (release tagging is separate) and no SDK source changed.
- Follow-up (separate plan if desired): run `ruff check --fix` to apply `py310` modernizations to the Python source, and adopt Node 20+ APIs in the TS SDK where they simplify code.
- Coordinate the actual npm/PyPI release via the tag-based workflow in `AGENTS.md` after these land.
