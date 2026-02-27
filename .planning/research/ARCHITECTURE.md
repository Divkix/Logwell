# Architecture Research

**Domain:** Go SDK CI pipeline in GitHub Actions monorepo
**Researched:** 2026-02-26
**Confidence:** HIGH — all findings verified against official action repositories, golangci-lint-action releases, and project's own existing SDK workflow patterns

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Workflow                        │
│                    .github/workflows/sdk-go.yml                  │
├──────────────────────────────────────────────────────────────────┤
│  TRIGGER LAYER                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ push/PR      │  │ workflow_    │  │ paths filter:          │ │
│  │ branches:    │  │ dispatch     │  │ sdks/go/**             │ │
│  │ [main]       │  │              │  │ .github/workflows/     │ │
│  │              │  │              │  │ sdk-go.yml             │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│  PARALLEL FAST-FAIL LAYER (no needs: deps, run concurrently)     │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │     lint     │  │              test-matrix                 │ │
│  │              │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │ │
│  │ golangci-    │  │  │ go 1.21  │ │ go 1.22  │ │ go 1.23  │ │ │
│  │ lint-action  │  │  │ -race    │ │ -race    │ │ -race    │ │ │
│  │ @v9          │  │  │ go vet   │ │ go vet   │ │ go vet   │ │ │
│  │              │  │  └──────────┘ └──────────┘ └──────────┘ │ │
│  └──────────────┘  └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│  COVERAGE LAYER (single version, produces artifact)              │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ coverage                                                      ││
│  │ go test -race -coverprofile=coverage.out ./...                ││
│  │ go tool cover -func=coverage.out → $GITHUB_STEP_SUMMARY      ││
│  └──────────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────────┤
│  GATE LAYER                                                       │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ ci-success                                                    ││
│  │ needs: [lint, test-matrix, coverage]                         ││
│  │ if: always() — aggregates all job results into single status ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `on.paths` trigger filter | Ensures workflow fires only on Go SDK changes | `sdks/go/**` + own workflow file path |
| `concurrency` group | Cancels stale in-progress runs on same branch/PR | `sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number \|\| github.ref }}` |
| `defaults.run.working-directory` | Pins all `run:` steps to `sdks/go/` without repeating per step | `working-directory: sdks/go` |
| `lint` job | Static analysis via golangci-lint aggregator | `golangci/golangci-lint-action@v9` with `version: v2.6` |
| `test-matrix` job | Multi-version test execution with race detector | `actions/setup-go@v6` + `go test -race ./...` matrix |
| `coverage` job | Single-version coverage profile generation | `go test -race -coverprofile=coverage.out ./...` + upload artifact |
| `ci-success` gate | Single required status check for branch protection | `if: always()` with explicit result checks |

## Recommended Project Structure

```
.github/
└── workflows/
    ├── ci.yml                # Main app CI (existing, no Go)
    ├── sdk-typescript.yml    # TypeScript SDK (existing pattern)
    ├── sdk-python.yml        # Python SDK (existing pattern)
    └── sdk-go.yml            # Go SDK CI (to create — this project)

sdks/go/
├── go.mod                    # module github.com/Divkix/Logwell/sdks/go, go 1.21
├── .golangci.yml             # golangci-lint configuration (create alongside CI)
└── logwell/
    ├── client.go
    ├── client_test.go
    ├── config.go
    ├── config_test.go
    ├── queue.go
    ├── queue_test.go
    ├── transport.go
    ├── transport_test.go
    ├── client_test_helpers.go
    ├── doc.go
    ├── errors.go
    ├── source.go
    └── types.go
```

### Structure Rationale

- **`sdk-go.yml` filename:** Matches the existing `sdk-typescript.yml` and `sdk-python.yml` naming convention in this repo. Consistency matters for discoverability.
- **`defaults.run.working-directory: sdks/go`:** Eliminates per-step `working-directory:` repetition. Established in the TypeScript and Python SDK workflows in this repo.
- **`.golangci.yml` in `sdks/go/`:** golangci-lint-action looks for config relative to `working-directory`. Placing it at `sdks/go/.golangci.yml` ensures the action picks it up correctly without needing explicit `--config` arg.

## Architectural Patterns

### Pattern 1: Path-Scoped Monorepo Trigger

**What:** Limit workflow execution to pushes/PRs that touch relevant paths. Include the workflow file itself so CI changes take effect immediately.

**When to use:** Any SDK or sub-project in a monorepo that should not trigger the root CI.

**Trade-offs:** Simple and effective for flat triggers. Does not handle cross-cutting changes (e.g., shared Go tooling at repo root — not applicable here since SDK is zero-dependency).

**Example:**
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
```

### Pattern 2: Go Version Matrix with Race Detector

**What:** Run tests against a range of supported Go versions simultaneously. Always include `-race` to catch data races in concurrent code (this SDK has a background queue and transport goroutines).

**When to use:** Libraries with a declared minimum Go version. Matrix spans `min-version` through `stable`.

**Trade-offs:** Each matrix leg is a separate job runner — costs minutes. For a stdlib-only library with 3 versions this is negligible. Do not use matrix for the `lint` job — golangci-lint on stable Go is sufficient and avoids duplicate lint noise.

**Example:**
```yaml
test-matrix:
  name: Test (Go ${{ matrix.go-version }})
  runs-on: ubuntu-latest
  timeout-minutes: 10
  strategy:
    fail-fast: false
    matrix:
      go-version: ["1.21", "1.22", "1.23"]

  steps:
    - uses: actions/checkout@v6

    - uses: actions/setup-go@v6
      with:
        go-version: ${{ matrix.go-version }}
        cache-dependency-path: sdks/go/go.sum

    - name: Run go vet
      run: go vet ./...

    - name: Run tests with race detector
      run: go test -v -race ./...
```

### Pattern 3: Dedicated Coverage Job (Separate from Matrix)

**What:** Run coverage on a single Go version (latest stable) in its own job. Keeps the matrix jobs clean; avoids uploading N coverage files for N versions.

**When to use:** Always. Coverage on a single canonical version is sufficient for a pure stdlib library.

**Trade-offs:** An extra job slot, but the coverage job runs in parallel with lint — no serial cost.

**Example:**
```yaml
coverage:
  name: Coverage
  runs-on: ubuntu-latest
  timeout-minutes: 10

  steps:
    - uses: actions/checkout@v6

    - uses: actions/setup-go@v6
      with:
        go-version: "1.23"
        cache-dependency-path: sdks/go/go.sum

    - name: Run tests with coverage
      run: go test -v -race -coverprofile=coverage.out -covermode=atomic ./...

    - name: Print coverage summary
      run: go tool cover -func=coverage.out >> $GITHUB_STEP_SUMMARY

    - name: Upload coverage artifact
      uses: actions/upload-artifact@v6
      with:
        name: go-sdk-coverage-${{ github.run_id }}
        path: sdks/go/coverage.out
        retention-days: 7
```

### Pattern 4: golangci-lint-action with working-directory

**What:** The official golangci-lint GitHub Action (`golangci/golangci-lint-action@v9`) handles tool installation, caching, and execution. Specify `working-directory` for monorepo sub-paths.

**When to use:** Always for Go projects. Do not invoke golangci-lint via `go run` or raw curl installs — the action handles version-pinned caching correctly.

**Trade-offs:** Action v9 requires Node.js 24 runtime (GitHub-hosted ubuntu-latest satisfies this). The `version: v2.6` pinning prevents surprise breakage from new linter rules on HEAD. golangci-lint v2 only (the action v7+ dropped v1 support).

**Example:**
```yaml
lint:
  name: Lint
  runs-on: ubuntu-latest
  timeout-minutes: 10

  steps:
    - uses: actions/checkout@v6

    - uses: actions/setup-go@v6
      with:
        go-version: stable
        cache-dependency-path: sdks/go/go.sum

    - uses: golangci/golangci-lint-action@v9
      with:
        version: v2.6
        working-directory: sdks/go
```

### Pattern 5: ci-success Gate Job

**What:** A terminal job with `if: always()` that checks all upstream job results and fails if any required job failed. Provides a single stable status check name for branch protection rules.

**When to use:** Every CI workflow. Branch protection configured against a matrix job name is fragile — matrix job names change when versions change. One gate job name never changes.

**Trade-offs:** Requires listing all required jobs explicitly in the `needs:` array. The `if: always()` is mandatory — without it the gate is skipped when an upstream job fails, making the status check appear as "skipped" (which branch protection can misinterpret as passing).

**Example:**
```yaml
ci-success:
  name: CI Success
  runs-on: ubuntu-latest
  timeout-minutes: 5
  needs: [lint, test-matrix, coverage]
  if: always()

  steps:
    - name: Check all jobs passed
      run: |
        if [[ "${{ needs.lint.result }}" != "success" ]] || \
           [[ "${{ needs.test-matrix.result }}" != "success" ]] || \
           [[ "${{ needs.coverage.result }}" != "success" ]]; then
          echo "One or more CI jobs failed"
          exit 1
        fi
        echo "All CI checks passed"
```

## Data Flow

### Trigger to Execution Flow

```
Push / PR to main (touching sdks/go/**)
    ↓
GitHub evaluates on.paths filter
    ↓
Workflow dispatched → 3 jobs start in parallel:
    ├── lint job
    │     └── golangci-lint-action → exit 0/1
    ├── test-matrix job (3 parallel legs)
    │     └── go vet + go test -race → exit 0/1 per version
    └── coverage job
          └── go test -coverprofile → coverage.out → artifact upload
    ↓
ci-success gate (waits for all 3)
    └── evaluates job results → final pass/fail status
```

### Caching Flow

```
actions/setup-go@v6
    ↓ reads
sdks/go/go.sum (cache-dependency-path)
    ↓ computes cache key:
${{ runner.os }}-go-${{ hashFiles('sdks/go/go.sum') }}
    ↓
GOPATH/pkg/mod cache restored from GitHub Actions cache
    ↓
go test / go vet / golangci-lint use cached modules
```

### Key Data Flows

1. **go.sum → cache key:** `actions/setup-go@v6` reads `sdks/go/go.sum` via `cache-dependency-path` to construct the module cache key. Since this SDK has zero external dependencies, the go.sum will be empty/minimal — cache misses are negligible but the pattern must still be correct for future deps.

2. **lint working-directory → path resolution:** `golangci-lint-action@v9` v8+ uses absolute paths when `working-directory` is set. The action changes to `sdks/go/` before running, so linter output file paths are relative to `sdks/go/` — correct for PR annotations.

3. **coverage.out → GITHUB_STEP_SUMMARY:** `go tool cover -func` writes to the step summary, making coverage visible in the Actions UI without a third-party action.

4. **matrix result → ci-success:** The `needs.test-matrix.result` check evaluates to `success` only if all matrix legs passed. A single failing Go version fails the gate.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (Go 1.21–1.23, ~13 files) | The described architecture is sufficient. 3-job parallel execution, all jobs under 10 minutes. |
| Adding Go versions | Add version string to `matrix.go-version` array. No structural change needed. |
| Adding external dependencies | `cache-dependency-path: sdks/go/go.sum` already covers this. No change needed when deps are added. |
| Adding govulncheck | Add as a step in the `lint` job or a separate parallel job. `golang.org/x/vuln/cmd/govulncheck` runs as `go run`. |
| Future: publish to pkg.go.dev | Out of scope per PROJECT.md. Would be a separate `publish` job triggered on tag, not part of this CI workflow. |

## Anti-Patterns

### Anti-Pattern 1: No Path Filtering

**What people do:** Define the workflow without `paths:` on `push`/`pull_request`.
**Why it's wrong:** Every commit to main — including frontend Svelte changes, README updates, database migrations — triggers Go CI. Wastes runner minutes and clutters PR status checks.
**Do this instead:** Always include `paths: ["sdks/go/**", ".github/workflows/sdk-go.yml"]` on both `push` and `pull_request` triggers.

### Anti-Pattern 2: Lint on Every Matrix Version

**What people do:** Include golangci-lint inside the `test-matrix` job so it runs for each Go version.
**Why it's wrong:** Lint results are identical across Go versions for a stdlib-only library. Running lint 3× wastes 3× the minutes. golangci-lint-action's own documentation states: "We recommend running this action in a job separate from other jobs (go test, etc.) because different jobs run on parallel runners."
**Do this instead:** Single `lint` job on `go-version: stable`, separate from the test matrix.

### Anti-Pattern 3: Missing `working-directory` on Lint Action

**What people do:** Run `golangci/golangci-lint-action@v9` without `working-directory` in a monorepo context.
**Why it's wrong:** The action runs from the repo root. It cannot find `go.mod` at the root (only at `sdks/go/go.mod`), causing "can't load package" errors or linting the wrong module.
**Do this instead:** Set `working-directory: sdks/go` in the `with:` block of the golangci-lint step.

### Anti-Pattern 4: Omitting Race Detector

**What people do:** Run `go test ./...` without `-race`.
**Why it's wrong:** The Logwell Go SDK has a background queue goroutine (`queue.go`) and HTTP transport (`transport.go`). Race conditions in these components are invisible to non-race tests but cause production data corruption.
**Do this instead:** Always use `go test -v -race ./...` for a library with concurrent internals.

### Anti-Pattern 5: Hardcoding `go-version` Instead of `go.mod` Min Version

**What people do:** Set `go-version: "1.21"` only, or `go-version: stable` only, missing the compatibility matrix.
**Why it's wrong:** Users of the SDK may be on Go 1.21 (the declared minimum) while the library author only tests on stable. A 1.22 API used by mistake will pass CI on stable but break 1.21 users.
**Do this instead:** Matrix from 1.21 (min per go.mod) through current stable. The matrix makes the compatibility guarantee explicit.

### Anti-Pattern 6: Using `actions/upload-artifact@v4` Instead of v6

**What people do:** Reference `upload-artifact@v4` by copying old examples.
**Why it's wrong:** The rest of this repo uses `upload-artifact@v6` (verified in `ci.yml`, `sdk-typescript.yml`). Mixing action versions creates inconsistency. v4 is supported but v6 is the project standard.
**Do this instead:** Use `actions/upload-artifact@v6` to match the established pattern.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| GitHub Actions cache | `actions/setup-go@v6` built-in cache | Keyed on `sdks/go/go.sum`; zero-dependency SDK means near-empty go.sum |
| golangci-lint binary | `golangci/golangci-lint-action@v9` | Installs pinned version into runner; its own cache separate from Go module cache |
| GitHub Step Summary | `>> $GITHUB_STEP_SUMMARY` | Coverage output written here; no third-party service needed |
| GitHub Artifacts | `actions/upload-artifact@v6` | Coverage profile stored 7 days; matches retention used by other SDK workflows |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `sdk-go.yml` workflow ↔ `ci.yml` workflow | Independent, no job dependencies | Go SDK CI does not depend on and does not block the main app CI |
| `lint` job ↔ `test-matrix` job | No `needs:` dependency — run in parallel | Both feed into `ci-success` gate |
| `test-matrix` legs ↔ each other | `fail-fast: false` — independent | One failing Go version does not cancel others; all versions reported |
| `defaults.run.working-directory` ↔ all `run:` steps | All steps automatically execute from `sdks/go/` | `golangci-lint-action` uses its own `working-directory:` input instead |

## Sources

- golangci-lint-action official GitHub repository: https://github.com/golangci/golangci-lint-action (HIGH confidence — official source; v9.2.0 confirmed as latest)
- actions/setup-go official README: https://github.com/actions/setup-go/blob/main/README.md (HIGH confidence — official; v6 is current with Node24 runtime)
- Existing project SDK workflows: `.github/workflows/sdk-typescript.yml`, `.github/workflows/sdk-python.yml` (HIGH confidence — directly observable)
- Existing project CI: `.github/workflows/ci.yml` (HIGH confidence — directly observable; establishes action version baseline)
- Go CI pipeline patterns article: https://oneuptime.com/blog/post/2025-12-20-go-ci-pipeline-github-actions/view (MEDIUM confidence — independently verified against official docs)
- Monorepo path filter patterns: https://oneuptime.com/blog/post/2026-02-02-github-actions-monorepos/view (MEDIUM confidence)

---
*Architecture research for: Go SDK CI pipeline in GitHub Actions monorepo*
*Researched: 2026-02-26*
