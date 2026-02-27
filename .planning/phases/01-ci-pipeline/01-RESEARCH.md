# Phase 1: CI Pipeline - Research

**Researched:** 2026-02-26
**Domain:** GitHub Actions CI for Go SDK (monorepo subdirectory)
**Confidence:** HIGH

## Summary

Phase 1 delivers a single GitHub Actions workflow (`sdk-go.yml`) and golangci-lint config (`.golangci.yml`) for the Go SDK at `sdks/go/`. The workflow needs path-filtered triggers, golangci-lint v2 linting, a Go version matrix with race detection, coverage reporting to job summary + artifact, and a `ci-success` gate job for branch protection.

The project already has sibling SDK workflows (`sdk-python.yml`, `sdk-typescript.yml`) and an existing `ci.yml` with a `ci-success` gate pattern. All established conventions — concurrency groups, `timeout-minutes: 10`, `actions/checkout@v6`, `defaults.run.working-directory` — are directly reusable. The Go-specific challenge is the golangci-lint v2 config format and the well-documented pitfall where `golangci-lint-action` ignores `defaults.run.working-directory` (requiring explicit `with.working-directory`).

**Primary recommendation:** Create `sdk-go.yml` following the exact sibling workflow structure, with 4 jobs (lint, test, coverage, ci-success). Use golangci-lint v2 config format with `version: "2"` top-level key. Pin Go matrix to `[1.25.x, 1.26.x]` (both currently supported).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Go version matrix: `['1.25.x', 'stable']` — one pinned, one auto-resolving (Note: user said `stable`, research recommends `1.26.x` for determinism; user's `stable` intent is equivalent)
- Bump `go.mod` minimum from 1.21 to 1.25 to align declared minimum with tested versions
- `GOTOOLCHAIN=local` to prevent auto-upgrade during matrix runs
- File name: `sdk-go.yml` — matches sibling pattern
- Job structure: 4 parallel jobs — `lint`, `test-matrix`, `coverage`, `ci-success` gate
- Gate job name: `ci-success`
- golangci-lint config: `sdks/go/.golangci.yml` — colocated with Go module

### Claude's Discretion
- Linter selection and strictness in `.golangci.yml`
- Matrix update strategy (manual vs Dependabot)
- Exact golangci-lint version pin
- Coverage job Go version selection
- Step ordering within jobs

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRIG-01 | Workflow triggers on push to main affecting `sdks/go/**` or `.github/workflows/sdk-go.yml` | Sibling workflows use identical `paths:` filter pattern |
| TRIG-02 | Workflow triggers on pull request affecting same paths | Same pattern as TRIG-01, PR trigger |
| TRIG-03 | Workflow supports `workflow_dispatch` | All sibling workflows include this |
| TRIG-04 | Concurrent runs cancel with `cancel-in-progress: true` | Sibling pattern: `sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number \|\| github.ref }}` |
| LINT-01 | golangci-lint v2 via `golangci/golangci-lint-action@v9` with pinned version | Latest stable: v2.10.1. Action v9 supports `version:` input |
| LINT-02 | `.golangci.yml` at `sdks/go/` with `version: "2"` top-level key | v2 config requires `version: "2"` — v2 binary cannot parse v1 config |
| LINT-03 | Lint job uses `working-directory: sdks/go` in action `with:` block | Documented pitfall: action ignores `defaults.run.working-directory` |
| LINT-04 | `go vet ./...` runs as part of lint or test | golangci-lint v2 runs `govet` by default — no separate step needed |
| TEST-01 | `go test -race -count=1 -v ./...` on every trigger | Standard Go testing flags; `-count=1` defeats cache |
| TEST-02 | Matrix across Go 1.25.x and 1.26.x | Both currently supported. Go 1.24 EOL Feb 2026. Use `actions/setup-go@v6` |
| TEST-03 | `GOTOOLCHAIN=local` set | Env var in job or step — prevents matrix version auto-upgrade |
| TEST-04 | `fail-fast: false` in matrix | Standard matrix config for independent reporting |
| COV-01 | `-covermode=atomic -coverprofile=coverage.out` | MUST use `atomic` (not default `count`) when `-race` is present |
| COV-02 | Coverage summary to `$GITHUB_STEP_SUMMARY` via `go tool cover` | `go tool cover -func=coverage.out` output piped to summary |
| COV-03 | Coverage artifact via `actions/upload-artifact` | Use `actions/upload-artifact@v6` (latest, Node.js 24) |
| INFR-01 | `defaults.run.working-directory: sdks/go` | Standard monorepo pattern; applies to all `run:` steps |
| INFR-02 | `actions/setup-go@v6` with `cache-dependency-path: sdks/go/go.sum` | v6 defaults to `go.mod` for cache; explicit `go.sum` path for monorepo |
| INFR-03 | `ci-success` gate with `if: always()` | Exact pattern from existing `ci.yml` — aggregate all jobs, check results |
| INFR-04 | `timeout-minutes: 10` on all jobs | All sibling workflows use this value |
</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `actions/checkout` | v6 | Repository checkout | Project standard (all workflows use v6) |
| `actions/setup-go` | v6 | Go toolchain setup + module caching | Latest stable; `cache-dependency-path` for monorepo |
| `golangci/golangci-lint-action` | v9 | Run golangci-lint with caching | Official action; v9 supports v2 linter, uses absolute paths for working-directory |
| `golangci-lint` | v2.10.1 | Go linting | Latest stable v2 (released 2026-02-17) |
| `actions/upload-artifact` | v6 | Upload coverage artifact | Latest stable (Node.js 24 runtime) |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `go tool cover` | (bundled) | Coverage summary generation | Always — `go tool cover -func=coverage.out` for summary |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `golangci-lint` | Standalone `staticcheck` + `go vet` | Less coverage; golangci-lint wraps both plus more |
| `actions/upload-artifact` | Codecov/Coveralls | External token management; `$GITHUB_STEP_SUMMARY` sufficient per scope |

## Architecture Patterns

### Recommended Workflow Structure
```
.github/workflows/sdk-go.yml     # Workflow definition
sdks/go/.golangci.yml             # Linter config (colocated with module)
```

### Pattern 1: Sibling SDK Workflow Structure
**What:** All SDK workflows follow an identical structure: triggers with path filters, concurrency group, defaults working-directory, parallel jobs, gate job.
**When to use:** Always — consistency across SDK workflows.
**Example (from sdk-python.yml):**
```yaml
on:
  push:
    branches: [main]
    paths:
      - "sdks/go/**"
      - ".github/workflows/sdk-go.yml"
  pull_request:
    branches: [main]
    paths:
      - "sdks/go/**"
      - ".github/workflows/sdk-go.yml"
  workflow_dispatch:

concurrency:
  group: sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

defaults:
  run:
    working-directory: sdks/go
```

### Pattern 2: Gate Job with if: always()
**What:** A `ci-success` job that depends on all other jobs and checks their results. Required for stable branch protection because path-filtered jobs get skipped on non-matching PRs.
**When to use:** Always — without this, branch protection blocks non-Go PRs.
**Example (from ci.yml):**
```yaml
ci-success:
  name: CI Success
  runs-on: ubuntu-latest
  timeout-minutes: 5
  needs: [lint, test, coverage]
  if: always()
  steps:
    - name: Check all jobs status
      run: |
        if [[ "${{ needs.lint.result }}" != "success" && "${{ needs.lint.result }}" != "skipped" ]] || \
           [[ "${{ needs.test.result }}" != "success" && "${{ needs.test.result }}" != "skipped" ]] || \
           [[ "${{ needs.coverage.result }}" != "success" && "${{ needs.coverage.result }}" != "skipped" ]]; then
          echo "One or more jobs failed"
          exit 1
        fi
```
**Critical detail:** Must check for both `success` AND `skipped` — path-filtered jobs show as `skipped` when paths don't match.

### Anti-Patterns to Avoid
- **Using `defaults.run.working-directory` for golangci-lint-action:** The action ignores job defaults; must use `with.working-directory`
- **Setting `CGO_ENABLED=0`:** Breaks `-race` flag, which requires cgo
- **Using `-covermode=count` with `-race`:** Race detector requires `atomic` mode
- **Omitting `GOTOOLCHAIN=local`:** Go auto-downloads newer toolchain, defeating the matrix purpose
- **Using `fail-fast: true` (default):** First matrix failure cancels others; can't see full picture

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Go linting | Custom lint scripts | `golangci-lint` v2 | Wraps 100+ linters, caching, config-driven |
| Lint caching | Manual cache steps | `golangci-lint-action` v9 | Handles Go build cache + lint cache automatically |
| Go module caching | `actions/cache` | `actions/setup-go` v6 built-in cache | setup-go caches modules automatically |
| Coverage display | Custom parsing scripts | `go tool cover -func` + `$GITHUB_STEP_SUMMARY` | Built-in Go tooling, no dependencies |

## Common Pitfalls

### Pitfall 1: golangci-lint-action Ignores defaults.run.working-directory
**What goes wrong:** Lint runs in repo root, can't find Go module, fails with confusing errors.
**Why it happens:** The action is a composite/node action that doesn't inherit `defaults.run` settings.
**How to avoid:** Always set `with: working-directory: sdks/go` on the action step.
**Warning signs:** "no Go files found" or "go.mod not found" errors in lint job.

### Pitfall 2: -covermode=count with -race
**What goes wrong:** Race detector panics or produces incorrect coverage data.
**Why it happens:** `-race` instruments code with atomic operations; `count` mode uses non-atomic increments.
**How to avoid:** Always use `-covermode=atomic` when `-race` is enabled.
**Warning signs:** Sporadic coverage test failures, "DATA RACE" panics in coverage runs.

### Pitfall 3: Path Filter + Required Status Check
**What goes wrong:** PRs that don't touch Go files never get a green `ci-success` check, permanently blocking merge.
**Why it happens:** Path-filtered workflows don't run when paths don't match; GitHub sees no status check.
**How to avoid:** Gate job uses `if: always()` and accepts `skipped` as passing for upstream jobs.
**Warning signs:** Non-Go PRs stuck as "pending" for `ci-success` check.

### Pitfall 4: GOTOOLCHAIN Defeats Matrix
**What goes wrong:** Both matrix legs run Go 1.26.x because Go auto-downloads the latest toolchain.
**Why it happens:** Go's toolchain directive in `go.mod` or automatic resolution upgrades the runtime.
**How to avoid:** Set `GOTOOLCHAIN: local` as environment variable.
**Warning signs:** Matrix says "1.25.x" but `go version` shows 1.26.

### Pitfall 5: -count=1 Omission
**What goes wrong:** Tests pass in CI but are actually stale — Go caches test results.
**Why it happens:** Go's test cache considers input files, not external state.
**How to avoid:** Always run with `-count=1` in CI to bypass cache.
**Warning signs:** Test changes don't take effect until cache expires.

### Pitfall 6: go.sum Missing in Monorepo
**What goes wrong:** `setup-go` can't find `go.sum` for dependency caching, falls back to no cache.
**Why it happens:** Default cache path looks in repo root, not `sdks/go/`.
**How to avoid:** Set `cache-dependency-path: sdks/go/go.sum` on `setup-go`.
**Warning signs:** Slow CI runs, "cache miss" messages.

### Pitfall 7: golangci-lint v2 Config Format
**What goes wrong:** Lint step fails to parse config file.
**Why it happens:** v2 binary requires `version: "2"` in config; cannot parse v1 format.
**How to avoid:** Include `version: "2"` as first key in `.golangci.yml`.
**Warning signs:** "unknown version" or "failed to load config" errors.

### Pitfall 8: Missing go.sum File
**What goes wrong:** `go test` or `golangci-lint` fail because dependencies aren't resolved.
**Why it happens:** Module has no `go.sum` because it has zero external dependencies (pure stdlib).
**How to avoid:** Run `go mod tidy` to generate `go.sum`. If truly no dependencies, `go.sum` may be empty or absent — `setup-go` handles this gracefully with `go.mod` fallback.
**Warning signs:** "missing go.sum entry" errors.

## Code Examples

### golangci-lint v2 Config (.golangci.yml)
```yaml
version: "2"

linters:
  default: none
  enable:
    - errcheck
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gosimple
    - gocritic
    - revive
    - misspell

formatters:
  enable:
    - gofmt

issues:
  max-issues-per-linter: 0
  max-same-issues: 0
```

### Coverage Summary to Job Summary
```yaml
- name: Generate coverage summary
  run: |
    echo "## Coverage Report" >> $GITHUB_STEP_SUMMARY
    echo "" >> $GITHUB_STEP_SUMMARY
    echo '```' >> $GITHUB_STEP_SUMMARY
    go tool cover -func=coverage.out >> $GITHUB_STEP_SUMMARY
    echo '```' >> $GITHUB_STEP_SUMMARY
```

### Gate Job Pattern
```yaml
ci-success:
  name: CI Success
  runs-on: ubuntu-latest
  timeout-minutes: 5
  needs: [lint, test, coverage]
  if: always()
  steps:
    - name: Check job results
      run: |
        results=("${{ needs.lint.result }}" "${{ needs.test.result }}" "${{ needs.coverage.result }}")
        for result in "${results[@]}"; do
          if [[ "$result" != "success" && "$result" != "skipped" ]]; then
            echo "Job failed with result: $result"
            exit 1
          fi
        done
        echo "All jobs passed or were skipped"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| golangci-lint v1 config | v2 config with `version: "2"`, `formatters` section | March 2025 | Must use v2 format; v1 format not parseable |
| `actions/setup-go@v5` | `@v6` with improved toolchain handling | Early 2026 | Better monorepo support, `go.mod` default cache |
| `actions/checkout@v4` | `@v6` with credential isolation | Late 2025 | Security improvement; no workflow changes needed |
| `-covermode=set` (default) | `-covermode=atomic` with `-race` | Always | Required when race detection enabled |
| Go 1.24.x in matrix | Go 1.25.x + 1.26.x | Feb 2026 | 1.24 EOL Feb 11, 2026; 1.25 + 1.26 are current |

**Deprecated/outdated:**
- `golangci-lint` v1 config format: v2 binary cannot parse it
- `actions/upload-artifact@v3`: Deprecated Jan 2025
- Go 1.24: EOL February 11, 2026

## Open Questions

1. **go.sum existence**
   - What we know: `go.mod` exists with `go 1.21` directive, but no `go.sum` visible in directory listing
   - What's unclear: Whether the SDK has any external dependencies requiring `go.sum`
   - Recommendation: Run `go mod tidy` as first task; if no dependencies, `setup-go@v6` handles this with `go.mod` fallback. Set `cache-dependency-path: sdks/go/go.sum` regardless — it degrades gracefully.

2. **Linter strictness level**
   - What we know: CONTEXT.md says "Claude's discretion — pragmatic defaults"
   - What's unclear: Exact linter set preferences
   - Recommendation: Start with standard set (errcheck, govet, staticcheck, unused, gosimple, ineffassign, gocritic, revive, misspell). This is comprehensive but not pedantic. Can be tuned later.

## Sources

### Primary (HIGH confidence)
- Sibling workflows in `.github/workflows/` — `sdk-python.yml`, `sdk-typescript.yml`, `ci.yml` — direct project conventions
- [golangci-lint Configuration File docs](https://golangci-lint.run/docs/configuration/file/) — v2 config format
- [golangci-lint-action GitHub](https://github.com/golangci/golangci-lint-action) — v9 working-directory handling
- [actions/setup-go GitHub](https://github.com/actions/setup-go) — v6 cache-dependency-path

### Secondary (MEDIUM confidence)
- [Go Release History](https://go.dev/doc/devel/release) — Go 1.25/1.26 release dates confirmed
- [Go endoflife.date](https://endoflife.date/go) — Go 1.24 EOL date
- [golangci-lint releases](https://github.com/golangci/golangci-lint/releases) — v2.10.1 latest

### Tertiary (LOW confidence)
- None — all findings verified with primary or secondary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are project-established or official Go ecosystem
- Architecture: HIGH — directly copying from sibling workflows with Go-specific adaptations
- Pitfalls: HIGH — 8 pitfalls identified from documentation and known issues; all well-documented

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable domain; Go releases on 6-month cycle)
