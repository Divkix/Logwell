# Stack Research

**Domain:** Go SDK CI Pipeline (GitHub Actions, monorepo)
**Researched:** 2026-02-26
**Confidence:** HIGH

## Context

The Logwell Go SDK (`sdks/go/`) is a zero-dependency, stdlib-only Go library targeting Go 1.21+. It lives inside a monorepo primarily hosting a SvelteKit application. The monorepo already has CI workflows for the main app, Python SDK, and TypeScript SDK — all following consistent patterns. This research establishes the standard stack for an equivalent Go SDK CI workflow.

---

## Recommended Stack

### Core GitHub Actions

| Action | Version | Purpose | Why Recommended |
|--------|---------|---------|-----------------|
| `actions/checkout` | `v6` | Checkout repository | Consistent with all existing monorepo workflows (ci.yml, sdk-python.yml, sdk-typescript.yml all use v6) |
| `actions/setup-go` | `v6` | Install Go toolchain | v6 released Feb 2026, upgrades runtime to Node 24, supports go.mod `toolchain` directive natively, auto-caches GOCACHE + GOMODCACHE |
| `golangci/golangci-lint-action` | `v9` | Run golangci-lint | Official action from golangci maintainers, v9 on Node 24 runtime, supports golangci-lint v2 natively, handles caching automatically |
| `actions/cache` | `v5` | Supplemental caching | Already used in monorepo; golangci-lint-action has its own cache but setup-go handles module cache |
| `actions/upload-artifact` | `v6` | Upload coverage profiles | Consistent with monorepo (all other workflows use v6) |

**Confidence:** HIGH — versions verified against GitHub releases pages (Feb 2026).

### Go Toolchain

| Component | Version | Purpose | Why |
|-----------|---------|---------|-----|
| Go minimum | `1.21` | SDK minimum requirement | Defined in `go.mod`; Go 1.21 was when the `go` directive became a mandatory minimum, not advisory |
| Go matrix | `['1.25.x', '1.26.x']` | Matrix test coverage | Go 1.25 and 1.26 are the two currently supported major releases (1.24 reached EOL Feb 11, 2026). Testing supported releases only — testing 1.21 in matrix is theater since Go stdlib is backward-compatible and the module only requires it at build time |
| `GOTOOLCHAIN` env | `local` | Prevent auto-upgrade | When matrix specifies `1.25.x`, the go.mod `go 1.21` + any `toolchain` directive will trigger Go's toolchain download mechanism. Setting `GOTOOLCHAIN=local` forces use of the installed version |

**Confidence:** HIGH — Go EOL dates verified via endoflife.date (Feb 2026). Toolchain pitfall verified via mvdan/github-actions-golang and official Go docs.

### Linting Stack

| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| `golangci-lint` | `v2` (latest: v2.10.1) | Comprehensive static analysis | Industry standard Go linter aggregator used by Kubernetes, Prometheus, Terraform. v2 released 2025, mandatory for new projects — v1 is end-of-life |
| `go vet` | (built-in via golangci-lint) | Official Go static analysis | Always included in golangci-lint default set; catches real bugs the compiler misses |
| `staticcheck` | (bundled in golangci-lint) | Advanced static analysis | Gold standard Go analyzer since 2016; golangci-lint bundles it |

**Confidence:** HIGH — golangci-lint v2.10.1 verified via GitHub releases (Feb 17, 2026). Action v9 verified.

### Testing Tools

| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| `go test -race` | stdlib | Race condition detection | SDK has concurrent queue and transport; race detector is mandatory for any concurrent library. Thread-safety is explicitly advertised in README |
| `go test -cover` | stdlib | Coverage measurement | Built-in, no external dependency, outputs to `-coverprofile` for reporting |
| `go test -covermode=atomic` | stdlib | Thread-safe coverage | Required when using `-race` flag; `set` mode is not safe with concurrent tests |

**Confidence:** HIGH — official Go documentation.

### Coverage Reporting

| Approach | Confidence | Rationale |
|----------|------------|-----------|
| Job summary via `go tool cover` + `$GITHUB_STEP_SUMMARY` | HIGH | No external service, no token setup, works for private repos, consistent with how Python workflow posts coverage summary |
| Threshold enforcement via `go-test-coverage` action | MEDIUM | `vladopajic/go-test-coverage` — serverless, enforces minimum threshold without Codecov. Optional addition if hard coverage gate is desired |

**Do NOT use Codecov** for this project at this stage. It requires an account, token secret, and external service. The Python SDK workflow already demonstrates self-contained coverage reporting via `$GITHUB_STEP_SUMMARY`. Stay consistent.

---

## golangci-lint v2 Configuration

The `.golangci.yml` must use the v2 format (top-level `version: "2"` key). v1 config format is rejected by v2 binary.

**Recommended baseline for a zero-dependency stdlib SDK:**

```yaml
version: "2"

run:
  timeout: 5m

linters:
  default: standard
  enable:
    - bodyclose
    - errcheck
    - errname
    - errorlint
    - exhaustive
    - gocritic
    - gosec
    - govet
    - ineffassign
    - misspell
    - nilerr
    - revive
    - staticcheck
    - unconvert
    - unparam
    - unused
    - whitespace

issues:
  max-same-issues: 0
  max-issues-per-linter: 0
```

**Rationale for linter selection:**
- `govet` + `staticcheck` + `errcheck` — the non-negotiable trio for any Go library
- `errorlint` — catches improper error wrapping (critical since SDK has custom error types)
- `gosec` — security scanner; HTTP transport, API keys in SDK make this relevant
- `exhaustive` — enforce complete switch statements on the `LogLevel` type
- `nilerr` — catches `return nil, nil` antipattern (SDK uses this pattern correctly but enforce it)
- `revive` — opinionated style linter, stricter than `golint` (which is archived)
- `misspell` — catches typos in comments/strings, important for public API docs
- `unparam` — catches unused function parameters in public API

**What NOT to enable:**
- `dupl` — too noisy for a focused SDK, flags intentional repetition in table-driven tests
- `gochecknoglobals` — SDK legitimately uses package-level error variables
- `funlen` — SDK has complex initialization functions that are correct at their length
- `gocognit`/`gocyclo` — complexity gates create pressure to obfuscate; trust the tests

---

## Workflow Structure

The workflow should follow the same job decomposition used in `sdk-python.yml` and `sdk-typescript.yml`:

```
lint     → independent job
test     → independent job (matrix: Go 1.25.x, 1.26.x)
coverage → sequential after test (single Go version)
```

### Key Configuration Blocks

**Path filtering (monorepo isolation):**
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
```

**Working directory default (avoids repeating in every step):**
```yaml
defaults:
  run:
    working-directory: sdks/go
```

**Concurrency (consistent with other SDK workflows):**
```yaml
concurrency:
  group: sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

**Go setup with caching:**
```yaml
- uses: actions/setup-go@v6
  with:
    go-version: ${{ matrix.go-version }}
    cache-dependency-path: sdks/go/go.sum
```

The `cache-dependency-path` is required because the monorepo root has no `go.sum` — the module is nested in `sdks/go/`. Without it, setup-go cannot find the sum file and caching fails silently.

**Race detector + coverage:**
```yaml
- run: go test -race -coverprofile=coverage.out -covermode=atomic ./...
```

**golangci-lint-action working directory:**
The action v9 handles `working-directory` correctly when `golangci-lint-action` is invoked with:
```yaml
- uses: golangci/golangci-lint-action@v9
  with:
    version: v2
    working-directory: sdks/go
```
Note: `defaults.run.working-directory` does NOT apply to `uses:` steps — must be set explicitly in the action's `with:` block.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `golangci-lint-action@v9` | Manual `golangci-lint` install via script | Action handles binary caching, version pinning, and integration with GitHub annotations natively. No reason to do it manually |
| `actions/setup-go@v6` | `go-version-file: sdks/go/go.mod` | Viable alternative — reads version from go.mod automatically. But go.mod specifies `1.21` which would pin to minimum, not latest; defeats matrix purpose. Better to specify versions explicitly in matrix |
| Matrix: `[1.25.x, 1.26.x]` | Matrix: `[1.21.x, 1.22.x, 1.23.x, 1.24.x, 1.25.x, 1.26.x]` | Testing EOL versions wastes CI minutes. Go stdlib compatibility is extremely stable. Testing 1.21-1.24 has zero practical value since 1.24 is EOL as of Feb 11, 2026 |
| Matrix: `[1.25.x, 1.26.x]` | Single version only | Missing one supported major is a gap; Go releases two majors/year and compatibility issues do occasionally appear |
| Job summary coverage | Codecov | Requires external account, secret token, third-party data transfer. Zero benefit over job summary for this project's current stage |
| golangci-lint v2 | golangci-lint v1 | v1 is end-of-life. v2 is mandatory for new projects in 2026 |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `golint` | Archived since 2022, no longer maintained | `revive` (active fork with same checks + more) |
| `megacheck` | Superseded, no longer exists as standalone | `staticcheck` (bundled in golangci-lint) |
| `go-staticcheck` action | Redundant — golangci-lint bundles staticcheck | `golangci-lint-action` with staticcheck enabled |
| `actions/checkout@v4` | Inconsistent with monorepo (all workflows use v6) | `actions/checkout@v6` |
| `codecov/codecov-action` | External service dependency, token required, overkill | Job summary via `$GITHUB_STEP_SUMMARY` |
| `golangci-lint enable-all` | Enables every linter including contradictory ones, produces thousands of false positives | Explicit `enable:` list on top of `default: standard` |
| Cross-platform matrix (Linux + macOS + Windows) | SDK is pure Go stdlib, zero platform-specific code. Triple the CI cost for zero benefit | `ubuntu-latest` only — consistent with project scope decision documented in PROJECT.md |

---

## Version Compatibility

| Component | Requires | Notes |
|-----------|----------|-------|
| `golangci-lint-action@v9` | golangci-lint >= v2.0.0 | v9 action only supports lint v2; v8 requires >= v2.1.0 |
| `golangci-lint v2` | Go 1.22+ to run the linter itself | The linter binary requires Go 1.22+ to execute, but the code being linted can target Go 1.21 |
| `actions/setup-go@v6` | Actions runner >= v2.327.1 | GitHub-hosted `ubuntu-latest` satisfies this |
| Go `GOTOOLCHAIN=local` | Go 1.21+ | GOTOOLCHAIN env var introduced in Go 1.21; safe to use here |

**Critical:** The golangci-lint binary requires Go 1.22+ to run. The `golangci-lint-action` manages this internally — it installs the lint binary separately from the project's Go version. No conflict.

---

## Installation / Setup Commands

```bash
# No installation needed for CI tools — all managed by GitHub Actions

# Local development: install golangci-lint
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest

# Run linter locally (from sdks/go/)
golangci-lint run ./...

# Run tests with race detector and coverage (from sdks/go/)
go test -race -coverprofile=coverage.out -covermode=atomic ./...

# View coverage report
go tool cover -func=coverage.out
```

---

## Sources

- `https://github.com/golangci/golangci-lint-action/releases` — v9.2.0 confirmed as latest; v9 on Node 24, v8 requires golangci-lint >= v2.1.0 (HIGH confidence)
- `https://github.com/actions/setup-go/releases` — v6.3.0 confirmed as latest, released Feb 26, 2026 (HIGH confidence)
- `https://github.com/golangci/golangci-lint/releases` — v2.10.1 confirmed as latest, released Feb 17, 2026 (HIGH confidence)
- `https://endoflife.date/go` — Go 1.24 EOL confirmed Feb 11, 2026; Go 1.25 and 1.26 are the two supported majors (HIGH confidence)
- `https://github.com/mvdan/github-actions-golang` — GOTOOLCHAIN=local recommendation for matrix testing (MEDIUM confidence, established community reference)
- `https://golangci-lint.run/docs/configuration/file/` — v2 config format uses top-level `version: "2"` (HIGH confidence, official docs)
- `https://gist.github.com/maratori/47a4d00457a92aa426dbd48a18776322` — Golden config reference for linter selection rationale (MEDIUM confidence, community expert)
- Existing monorepo workflows (`ci.yml`, `sdk-python.yml`, `sdk-typescript.yml`) — action version consistency baseline (HIGH confidence, direct observation)

---
*Stack research for: Go SDK CI Pipeline (GitHub Actions, monorepo)*
*Researched: 2026-02-26*
