# Architecture

**Domain:** Go SDK CI/CD Workflow (GitHub Actions, subdirectory module in monorepo)
**Researched:** 2026-02-26

## Context

Adding a CI workflow for the Go SDK (`sdks/go/`) in a monorepo that already has Python and TypeScript SDK workflows. The Go module path is `github.com/Divkix/Logwell/sdks/go` -- a subdirectory module requiring special handling for tags, caching, and linting.

---

## Job Dependency Graph

```
lint ──────────────────────────────────┐
                                       ├──> publish (main push only)
test-unit (matrix: 1.22 / 1.23 / 1.24)┤
                                       │
build ─────────────────────────────────┘
```

- `lint`, `test-unit`, and `build` run in parallel (no interdependencies)
- `publish` requires all three to pass: `needs: [lint, test-unit, build]`
- `publish` only runs on main branch push or workflow_dispatch

---

## Components

### 1. Workflow Skeleton (Triggers + Infrastructure)

**Purpose:** Define when the workflow runs and shared configuration.

**Triggers:**
- `push.branches: [main]` with `paths: ["sdks/go/**", ".github/workflows/sdk-go.yml"]`
- `pull_request.branches: [main]` with same paths
- `push.tags: ["sdks/go/v*"]` -- for publish
- `workflow_dispatch`

**Shared config:**
- `permissions: contents: read`
- `concurrency: group: sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: true`
- `defaults.run.working-directory: sdks/go`

### 2. Lint Job

**Purpose:** Static analysis and code quality checks.

**Key components:**
- `actions/checkout@v6`
- `actions/setup-go@v5` with `go-version: "1.24"` and `cache-dependency-path: sdks/go/go.sum`
- `golangci/golangci-lint-action@v9` with `working-directory: sdks/go` (does NOT respect `defaults.run.working-directory` -- must be passed as action input)
- `go mod tidy` verification: `go mod tidy && git diff --exit-code go.mod go.sum`

**Critical note:** golangci-lint-action v9 supports golangci-lint v2. Config file `.golangci.yml` must have `version: "2"` as the first key.

### 3. Test-Unit Job

**Purpose:** Verify SDK works across Go version matrix.

**Key components:**
- `actions/setup-go@v5` with `matrix.go-version` and `cache-dependency-path: sdks/go/go.sum`
- `go test -race -v ./...` -- race detector is critical because `client_test.go` has concurrency tests
- Matrix: `go-version: ["1.22", "1.23", "1.24"]`

### 4. Build Job

**Purpose:** Verify the package compiles cleanly.

**Key components:**
- `actions/setup-go@v5` with `go-version: "1.24"` (latest stable)
- `go build ./...`
- `go vet ./...`

### 5. Publish Job

**Purpose:** Warm the Go module proxy when a version tag is pushed.

**Key components:**
- `needs: [lint, test-unit, build]`
- `if: github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')`
- `actions/checkout@v6` with `fetch-tags: true` (default shallow clone omits tags)
- Extract version from tag: `git tag --points-at HEAD | grep '^sdks/go/v'`
- Warm proxy: `GOPROXY=proxy.golang.org go list -m github.com/Divkix/Logwell/sdks/go@$VERSION`
- Skip guard: if `go list -m` succeeds before warming, version already indexed
- Job summary output to `$GITHUB_STEP_SUMMARY` (matching Python/TypeScript pattern)

**Critical note:** Do NOT use `go get` in CI -- it mutates `go.mod`. Use `go list -m` instead.

---

## Data Flow

```
Source code (sdks/go/**)
  |
  v
[checkout] --> shared across all jobs (each gets its own clone)
  |
  +--> [lint]       : golangci-lint reads .golangci.yml, analyzes source
  |                   go mod tidy verifies dependency consistency
  |
  +--> [test-unit]  : go test downloads deps to ~/go/pkg/mod (cached by setup-go)
  |                   test results to stdout (no artifact upload needed)
  |
  +--> [build]      : go build verifies compilation
  |                   go vet checks for suspicious constructs
  |
  +--> [publish]    : reads git tags from checkout
                      extracts version string
                      sends HTTP request to proxy.golang.org via go list -m
                      writes summary to GITHUB_STEP_SUMMARY
```

---

## Caching Strategy

| Cache | Mechanism | Key |
|-------|-----------|-----|
| Go module cache (`~/go/pkg/mod`) | `actions/setup-go@v5` with `cache: true` | Keyed on `go.sum` hash |
| golangci-lint cache | Built into `golangci-lint-action@v9` | Automatic |

**Critical:** `actions/setup-go` requires `cache-dependency-path: sdks/go/go.sum` for subdirectory modules. Without it, setup-go looks for `go.sum` at the repo root (which doesn't exist) and caching silently breaks.

---

## Subdirectory Module Gotchas

1. **Tag format:** Must be `sdks/go/vX.Y.Z` (not just `vX.Y.Z`). Go toolchain uses the module path prefix to match tags to subdirectory modules.
2. **`working-directory` in actions:** `defaults.run.working-directory` only applies to `run:` steps, NOT to action inputs. golangci-lint-action needs explicit `working-directory` input.
3. **`cache-dependency-path`:** Must point to `sdks/go/go.sum` for setup-go caching to work.
4. **`fetch-tags: true`:** Required in checkout for publish job to see tags.

---

## Suggested Build Order (Implementation Phases)

1. **Workflow skeleton** -- triggers, concurrency, defaults, permissions
2. **go.mod bump** to 1.22 + **golangci-lint config** (`sdks/go/.golangci.yml` with v2 schema)
3. **lint job** -- golangci-lint-action@v9 + go mod tidy check
4. **test-unit job** -- matrix [1.22, 1.23, 1.24] + `go test -race -v ./...`
5. **build job** -- `go build ./...` + `go vet ./...`
6. **publish job** -- tag detection + proxy warming + job summary

---

## Open Questions

- Pin golangci-lint to specific version (e.g., `v2.6`) or use `latest`? Pinning is safer for reproducibility.
- Should the publish job trigger on tag push events, or should it detect tags on main branch pushes? (Current design: detect tags on HEAD during main push)

---

## Sources

- [golangci-lint-action (official)](https://github.com/golangci/golangci-lint-action) -- v9 confirmed latest
- [actions/setup-go (official)](https://github.com/actions/setup-go) -- v5 confirmed, cache-dependency-path documented
- [golangci-lint v2 configuration](https://golangci-lint.run/docs/configuration/file/) -- version: "2" schema
- [Go Modules Reference](https://go.dev/ref/mod) -- subdirectory module tag format
- [proxy.golang.org](https://proxy.golang.org/) -- proxy warming behavior
- Existing `sdk-python.yml` and `sdk-typescript.yml` -- job structure reference
