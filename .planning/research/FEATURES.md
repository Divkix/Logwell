# Feature Research

**Domain:** Go SDK CI pipeline (GitHub Actions, monorepo library)
**Researched:** 2026-02-26
**Confidence:** HIGH (based on existing sibling SDK workflows + verified current tooling docs)

## Feature Landscape

### Table Stakes (Users Expect These)

Features every Go library CI must have. Missing any of these and the pipeline is not fit for purpose.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `go test ./...` with race detector (`-race`) | Standard Go practice; race conditions are a class of bugs the Go runtime catches only at runtime; any concurrent code must be tested this way | LOW | `go test -race -v ./...` — race detector is built into the Go toolchain, no extra deps |
| `go vet ./...` | Built-in static analysis; catches suspicious constructs that are technically valid but likely wrong (printf mismatches, unreachable code, etc.) | LOW | Zero config, zero deps; runs in seconds; expected as baseline by Go community |
| `golangci-lint` | Industry-standard linter aggregator; runs `staticcheck`, `errcheck`, `gosimple`, `ineffassign`, and 60+ others in one pass | LOW | Use `golangci/golangci-lint-action` official action; requires `.golangci.yml` config in `sdks/go/` |
| Matrix build across Go versions | SDK claims 1.21+ support; must verify it actually builds and passes tests on each supported minor | MEDIUM | Matrix: `[1.21, 1.22, 1.23, 1.24]` or current stable + minimum; `actions/setup-go` handles this |
| Path filtering (`sdks/go/**`) | SDK lives in monorepo; CI must not fire on unrelated SvelteKit changes | LOW | `paths:` filter in `on.push` and `on.pull_request` triggers; pattern established by `sdk-typescript.yml` and `sdk-python.yml` |
| Go module cache | Go downloads all module dependencies on every run without cache; even a stdlib-only project still needs the toolchain cache (`~/.cache/go-build`) | LOW | `actions/setup-go` with `cache: true` handles this automatically using `go.sum` as cache key since Go 1.21+ |
| `defaults.run.working-directory: sdks/go` | All `run:` steps must execute from the correct subdirectory in the monorepo | LOW | Single `defaults` block at workflow level; pattern established by both sibling SDK workflows |
| Concurrency group + cancel-in-progress | Avoid queuing redundant runs when new commits arrive during a CI run | LOW | `concurrency:` block with `cancel-in-progress: true`; pattern established in `ci.yml` and both sibling SDK workflows |
| `workflow_dispatch` trigger | Allow manual re-runs without a code push; required for debugging and release verification | LOW | Single line addition to `on:` block |
| `go build ./...` verification | Confirm the package compiles cleanly across all matrix versions, separate from test pass | LOW | `go build ./...` run before tests; distinct from test job, catches import cycles and compile errors |
| Timeout per job | Prevent runaway jobs consuming minutes/hours of CI credit | LOW | `timeout-minutes: 10` on test and lint jobs; established pattern in all existing workflows |
| Test coverage report | Coverage gate enforces quality floor; without it, coverage silently degrades | MEDIUM | `go test -coverprofile=coverage.out ./...` then `go tool cover` or upload to Codecov; threshold enforcement is the harder part |

### Differentiators (Competitive Advantage)

Not required for the pipeline to be functional, but make it meaningfully better.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `govulncheck` security scanning | Checks Go module graph against the Go vulnerability database (vuln.go.dev); reports only vulnerabilities reachable via the call graph, eliminating false positives | MEDIUM | Official `golang/govulncheck-action`; should run on schedule (weekly) in addition to PRs since new CVEs appear after code ships; produces SARIF for GitHub Security tab |
| Coverage upload to summary | Post coverage percentage as a GitHub job summary on every PR; no external service required | LOW | `go tool cover -func coverage.out >> $GITHUB_STEP_SUMMARY` — zero dependencies, no tokens, visible in PR UI |
| Coverage threshold enforcement | Hard-fail CI if coverage drops below a configured floor; prevents gradual coverage decay | LOW | `go test -coverprofile=coverage.out && go tool cover -func coverage.out \| grep total \| awk '{if ($3+0 < 80) exit 1}'` or use `gotestsum` with threshold flags |
| Separate lint job (parallel with test) | Lint and test run independently and in parallel; faster total wall-clock time | LOW | Two jobs: `lint` and `test`; lint does not block test from starting; pattern from Python SDK (separate `lint` job) |
| `go test -count=1` flag | Disables test result caching; ensures tests always re-execute in CI, not served from Go's test cache | LOW | Single flag addition; catches flaky tests that pass in cache but fail fresh |
| Job summary with test counts | Surface pass/fail/skip counts in the GitHub UI without opening logs | MEDIUM | Use `gotestsum --junitxml=report.xml` and parse it, or `gotestsum --format github-actions`; adds one dependency |
| Pin `golangci-lint` version | Avoid surprise lint failures when golangci-lint releases new rules | LOW | `version: v1.x.x` in `golangci/golangci-lint-action` step; update manually or via Dependabot |
| Dependabot config for Go actions | Keep `actions/setup-go`, `golangci/golangci-lint-action`, `golang/govulncheck-action` updated automatically | LOW | `sdks/go` already listed under `dependabot.yml` directory scope check; if not, add `go` ecosystem entry |
| `go mod tidy` drift check | Verify `go.mod` and `go.sum` are not stale; catches cases where developers forgot to run `go mod tidy` | LOW | `go mod tidy && git diff --exit-code go.mod go.sum` — fails CI if tidy produces any changes |

### Anti-Features (Commonly Requested, Often Problematic)

Features to explicitly NOT build in v1.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Cross-platform matrix (Windows/macOS) | "Test everywhere" instinct; Go compiles cross-platform | This SDK is a zero-dependency HTTP client library with stdlib only; platform differences in network behavior do not affect it meaningfully; doubles or triples runner costs for negligible value | Linux only; `PROJECT.md` explicitly calls out "Cross-platform testing — Linux CI sufficient for pure Go library" |
| Release automation via goreleaser | Automate `pkg.go.dev` publishing, GitHub releases, changelogs | Go modules are published automatically to `pkg.go.dev` by pushing a version tag — no goreleaser needed; goreleaser is for binary distributions; adding it creates complexity without value for a library | Tag-based release: create a git tag `sdks/go/v0.x.x`, push it, proxy.golang.org picks it up; out of scope per `PROJECT.md` |
| Integration tests against live Logwell server | Validate SDK against real server | Requires provisioning a live server in CI (service containers, seeds, migrations); flaky due to network; `PROJECT.md` explicitly calls this out of scope | Unit tests with `httptest.Server` mock the Logwell endpoint; transport_test.go already uses this pattern |
| Coverage upload to Codecov/Coveralls | Third-party coverage dashboards with trend graphs | Requires external service, tokens, account setup; overkill for a library with a small team; dashboard adds maintenance burden | GitHub job summary coverage report (built-in, zero config, zero tokens) |
| `go generate` execution in CI | Run code generation as part of CI | Not applicable: this SDK has no generated code; adds no value and risks non-determinism if generators produce different output per environment | Run `go generate` locally; commit generated files; CI verifies committed code only |
| `staticcheck` standalone (separate from golangci-lint) | staticcheck is powerful | golangci-lint already runs staticcheck as a bundled linter; running both wastes time and creates duplicate findings | Enable staticcheck via golangci-lint config |

## Feature Dependencies

```
[Path filtering: sdks/go/**]
    └──required by──> [All jobs] (without it, monorepo noise breaks CI)

[actions/setup-go with cache: true]
    └──required by──> [go test job]
    └──required by──> [go vet job]
    └──required by──> [golangci-lint job]  (lint action handles its own setup-go internally)

[go build ./...]
    └──should precede──> [go test -race ./...]  (fail fast on compile errors before long test run)

[go test -coverprofile=coverage.out]
    └──enables──> [Coverage threshold enforcement]
    └──enables──> [Coverage upload to job summary]

[golangci-lint job] ──parallel with──> [test job]
    (no dependency between lint and test; run simultaneously)

[govulncheck]
    └──independent of──> [test job]  (separate job, can run in parallel)
    └──scheduled weekly──> (independent of push/PR triggers)

[Matrix: go-version]
    └──applies to──> [go test job only]  (lint on latest stable only; running golangci-lint on 4 versions is wasteful)
```

### Dependency Notes

- **Path filtering requires monorepo awareness**: `on.push.paths` and `on.pull_request.paths` must include both `sdks/go/**` and `.github/workflows/sdk-go.yml` so the workflow itself can be updated without requiring a Go file change to trigger validation.
- **golangci-lint uses its own setup-go internally**: The `golangci/golangci-lint-action` installs its own Go environment. Do not run `actions/setup-go` before it in the lint job unless you need a specific Go version that differs from the linter's default.
- **Matrix on test only, not lint**: Lint on 4 Go versions is redundant; lint on latest stable is sufficient. Test matrix covers compatibility. This reduces total runner-minutes by ~75% on the lint dimension.
- **Coverage threshold conflicts with race + matrix**: If matrix runs 4 Go versions, only one should upload/report coverage (typically the minimum supported version or latest stable, not all four). Upload from a single, designated matrix slot using `if: matrix.go-version == '1.21'`.

## MVP Definition

### Launch With (v1)

Minimum viable pipeline — sufficient to prevent broken SDK releases.

- [ ] Path filtering (`sdks/go/**` + `.github/workflows/sdk-go.yml`) — without this every SvelteKit commit triggers Go CI
- [ ] `defaults.run.working-directory: sdks/go` — all commands run in correct directory
- [ ] Concurrency group with `cancel-in-progress: true` — prevent queue buildup on fast-push branches
- [ ] `go vet ./...` — zero-config static analysis, catches real bugs
- [ ] `golangci-lint` (pinned version) via official action — comprehensive linting in one step
- [ ] `go test -race -v -count=1 ./...` — tests with race detector, no caching, verbose output
- [ ] Matrix: `[1.21, 1.22, 1.23, 1.24]` on test job — validates stated 1.21+ compatibility claim
- [ ] `actions/setup-go` with `cache: true` on test job — Go module/build cache for speed
- [ ] Coverage report to job summary — no external service, visible in PR UI
- [ ] `timeout-minutes: 10` on all jobs — prevent runaway runners
- [ ] `workflow_dispatch` trigger — allow manual runs

### Add After Validation (v1.x)

Add once the baseline pipeline is working and trusted.

- [ ] `govulncheck` job (weekly schedule + PR) — security scanning; low friction once baseline runs cleanly
- [ ] `go mod tidy` drift check — catches forgotten `go mod tidy` runs before they accumulate
- [ ] Coverage threshold enforcement — set threshold once you know your actual baseline (avoid setting 80% before measuring)

### Future Consideration (v2+)

Defer until there is a validated reason.

- [ ] `gotestsum` for structured test output — nice-to-have; adds a dependency; evaluate if log readability becomes a pain point
- [ ] Release automation — separate concern, separate workflow; publish to `pkg.go.dev` via git tag; out of scope per `PROJECT.md`

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Path filtering | HIGH (prevents noise) | LOW | P1 |
| `go test -race` + matrix | HIGH (core purpose) | LOW | P1 |
| `go vet` | HIGH (catches real bugs) | LOW | P1 |
| `golangci-lint` | HIGH (comprehensive lint) | LOW | P1 |
| Go module cache | HIGH (speed, no download on every run) | LOW | P1 |
| Concurrency cancel | MEDIUM (CI hygiene) | LOW | P1 |
| Coverage → job summary | MEDIUM (visibility) | LOW | P1 |
| `timeout-minutes` | MEDIUM (cost control) | LOW | P1 |
| `govulncheck` | MEDIUM (security hygiene) | LOW | P2 |
| `go mod tidy` check | MEDIUM (consistency) | LOW | P2 |
| Coverage threshold | MEDIUM (quality gate) | LOW | P2 |
| `gotestsum` | LOW (DX improvement) | LOW | P3 |
| Cross-platform matrix | LOW (pure Go stdlib-only) | HIGH | ANTI |
| goreleaser | LOW (library, not binary) | HIGH | ANTI |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration
- ANTI: Explicitly avoid in v1

## Competitor Feature Analysis

Reference: sibling SDK CI workflows in this same repository.

| Feature | sdk-python.yml | sdk-typescript.yml | Go SDK (our plan) |
|---------|---------------|-------------------|-------------------|
| Path filtering | YES | YES | YES (required) |
| Working directory default | YES | YES | YES (required) |
| Lint job | YES (ruff + mypy) | YES (biome + tsc) | YES (golangci-lint + go vet) |
| Unit test job | YES (matrix: 4 Python versions) | YES (single version) | YES (matrix: 4 Go versions) |
| Integration test job | YES | YES | NO (not applicable; tests use httptest) |
| Coverage job | YES (separate job, 90% threshold) | NO | YES (inline with test, summary only in v1) |
| Build verification | YES (wheel build + twine check) | YES (tsc + attw + size) | PARTIAL (go build ./... inline with test) |
| Publish job | YES (PyPI via OIDC) | YES (npm + JSR via OIDC) | NO (out of scope v1; pkg.go.dev is tag-based) |
| Security scanning | NO | NO | YES (govulncheck, v1.x) |
| Concurrency cancel | YES | YES | YES |
| Workflow dispatch | YES | YES | YES |

## Sources

- [golangci/golangci-lint-action (official GitHub Action)](https://github.com/golangci/golangci-lint-action) — MEDIUM confidence (GitHub)
- [golang/govulncheck-action (official Go team action)](https://github.com/golang/govulncheck-action) — MEDIUM confidence (GitHub)
- [actions/setup-go — caching enabled by default](https://github.com/blog/changelog/2023-03-24-github-actions-the-setup-go-action-now-enables-caching-by-default/) — HIGH confidence (official GitHub changelog)
- [Go CI Pipeline with GitHub Actions (oneuptime.com, 2025-12)](https://oneuptime.com/blog/post/2025-12-20-go-ci-pipeline-github-actions/view) — MEDIUM confidence (recent, verified against stdlib patterns)
- [govulncheck GitHub Actions integration (jvt.me, 2025-09)](https://www.jvt.me/posts/2025/09/11/govulncheck-github-actions/) — MEDIUM confidence
- [Automating Go Dependency Security with govulncheck (Medium, 2025-12)](https://medium.com/@vishvadiniravihari/automating-go-dependency-security-with-govulncheck-in-github-actions-1d629d1424c8) — MEDIUM confidence
- Existing sibling workflows: `.github/workflows/sdk-typescript.yml`, `.github/workflows/sdk-python.yml` — HIGH confidence (this repository, authoritative for conventions)
- Existing main CI: `.github/workflows/ci.yml` — HIGH confidence (this repository, authoritative for patterns)
- `PROJECT.md` (`.planning/PROJECT.md`) — HIGH confidence (authoritative scope definition)

---
*Feature research for: Go SDK CI pipeline (GitHub Actions, monorepo)*
*Researched: 2026-02-26*
