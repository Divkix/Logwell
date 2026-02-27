# Requirements: Logwell Go SDK CI

**Defined:** 2026-02-26
**Core Value:** Every change to the Go SDK is automatically tested, linted, and validated before merge — no broken SDK releases reach users.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Workflow Triggers

- [ ] **TRIG-01**: Workflow triggers on push to main affecting `sdks/go/**` or `.github/workflows/sdk-go.yml`
- [ ] **TRIG-02**: Workflow triggers on pull request affecting `sdks/go/**` or `.github/workflows/sdk-go.yml`
- [ ] **TRIG-03**: Workflow supports manual dispatch via `workflow_dispatch`
- [ ] **TRIG-04**: Concurrent runs on same branch cancel in-progress with `cancel-in-progress: true`

### Linting

- [ ] **LINT-01**: `golangci-lint` v2 runs via `golangci/golangci-lint-action@v9` with pinned version
- [ ] **LINT-02**: `.golangci.yml` config file exists at `sdks/go/` with `version: "2"` top-level key
- [ ] **LINT-03**: Lint job uses explicit `working-directory: sdks/go` in action `with:` block (not job defaults)
- [ ] **LINT-04**: `go vet ./...` runs as part of lint or test pipeline

### Testing

- [ ] **TEST-01**: `go test -race -count=1 -v ./...` runs on every trigger
- [ ] **TEST-02**: Tests run in a matrix across Go 1.25.x and 1.26.x (current supported releases)
- [ ] **TEST-03**: `GOTOOLCHAIN=local` is set to prevent auto-upgrade during matrix runs
- [ ] **TEST-04**: Test matrix uses `fail-fast: false` to report all failures

### Coverage

- [ ] **COV-01**: Coverage profile generated with `-covermode=atomic -coverprofile=coverage.out`
- [ ] **COV-02**: Coverage summary written to `$GITHUB_STEP_SUMMARY` via `go tool cover`
- [ ] **COV-03**: Coverage artifact uploaded via `actions/upload-artifact`

### Infrastructure

- [ ] **INFR-01**: All `run:` steps execute from `sdks/go/` via `defaults.run.working-directory`
- [ ] **INFR-02**: `actions/setup-go@v6` with `cache-dependency-path: sdks/go/go.sum` for module cache
- [ ] **INFR-03**: `ci-success` gate job aggregates all jobs with `if: always()` for stable branch protection
- [ ] **INFR-04**: All jobs have `timeout-minutes: 10` to prevent runaway runners

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Security

- **SEC-01**: `govulncheck` runs via `golang/govulncheck-action` on PRs and weekly schedule
- **SEC-02**: `govulncheck` results reported to GitHub Security tab via SARIF

### Quality Gates

- **QUAL-01**: `go mod tidy` drift check fails CI if `go.mod` or `go.sum` are stale
- **QUAL-02**: Coverage threshold enforcement at measured baseline (set after Phase 1 runs)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-platform matrix (Windows/macOS) | Pure Go stdlib library, no platform-specific behavior; triples CI cost |
| Release automation (goreleaser) | Go libraries publish to pkg.go.dev via git tag, no tooling needed |
| Codecov/Coveralls integration | `$GITHUB_STEP_SUMMARY` sufficient; avoids external tokens and accounts |
| Integration tests against live Logwell | Requires infrastructure; unit tests with httptest are sufficient |
| `staticcheck` standalone | Already bundled in golangci-lint |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRIG-01 | Phase 1 | Pending |
| TRIG-02 | Phase 1 | Pending |
| TRIG-03 | Phase 1 | Pending |
| TRIG-04 | Phase 1 | Pending |
| LINT-01 | Phase 1 | Pending |
| LINT-02 | Phase 1 | Pending |
| LINT-03 | Phase 1 | Pending |
| LINT-04 | Phase 1 | Pending |
| TEST-01 | Phase 1 | Pending |
| TEST-02 | Phase 1 | Pending |
| TEST-03 | Phase 1 | Pending |
| TEST-04 | Phase 1 | Pending |
| COV-01 | Phase 1 | Pending |
| COV-02 | Phase 1 | Pending |
| COV-03 | Phase 1 | Pending |
| INFR-01 | Phase 1 | Pending |
| INFR-02 | Phase 1 | Pending |
| INFR-03 | Phase 1 | Pending |
| INFR-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after initial definition*
