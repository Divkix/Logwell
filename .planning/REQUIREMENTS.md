# Requirements: Logwell Go SDK CI Workflow

**Defined:** 2026-02-26
**Core Value:** The Go SDK has the same quality gate and automated publish pipeline as the Python and TypeScript SDKs

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [ ] **FOUND-01**: go.mod minimum version bumped from 1.21 to 1.22
- [ ] **FOUND-02**: golangci-lint v2 config file exists at `sdks/go/.golangci.yml` with `version: "2"`, practical linter set (govet, errcheck, staticcheck, ineffassign, unused), and gofmt/goimports formatters

### Workflow Infrastructure

- [ ] **INFRA-01**: Workflow file exists at `.github/workflows/sdk-go.yml`
- [ ] **INFRA-02**: Workflow triggers on push to main with path filter `sdks/go/**` and `.github/workflows/sdk-go.yml`
- [ ] **INFRA-03**: Workflow triggers on PRs to main with same path filters
- [ ] **INFRA-04**: Workflow triggers on tag push matching `sdks/go/v*`
- [ ] **INFRA-05**: Workflow triggers on `workflow_dispatch`
- [ ] **INFRA-06**: Concurrency group `sdk-go-${{ github.workflow }}-${{ ... }}` with `cancel-in-progress: true`
- [ ] **INFRA-07**: `defaults.run.working-directory: sdks/go` set at workflow level
- [ ] **INFRA-08**: `timeout-minutes` set on every job (10 minutes)
- [ ] **INFRA-09**: `permissions: contents: read` at workflow level

### Linting

- [ ] **LINT-01**: Lint job uses `golangci/golangci-lint-action@v9` with pinned golangci-lint version
- [ ] **LINT-02**: Lint job passes `working-directory: sdks/go` directly to action `with:` (not relying on job defaults)
- [ ] **LINT-03**: Lint job uses `actions/setup-go@v6` before golangci-lint-action
- [ ] **LINT-04**: Lint job includes `go mod tidy` verification step (`go mod tidy && git diff --exit-code go.mod go.sum`)

### Testing

- [ ] **TEST-01**: Unit test job runs `go test -race -v ./...`
- [ ] **TEST-02**: Unit test job uses Go version matrix: 1.22, 1.23, 1.24
- [ ] **TEST-03**: Unit test job uses `actions/setup-go@v6` with `cache-dependency-path: sdks/go/go.sum`
- [ ] **TEST-04**: Unit test job uses `strategy.fail-fast: false`

### Build

- [ ] **BILD-01**: Build job runs `go build ./...`
- [ ] **BILD-02**: Build job runs `go vet ./...`
- [ ] **BILD-03**: Build job uses `actions/setup-go@v6` with latest stable Go version

### Publishing

- [ ] **PUBL-01**: Publish job requires lint, test-unit, and build to pass (`needs: [lint, test-unit, build]`)
- [ ] **PUBL-02**: Publish job only runs on tag push matching `sdks/go/v*` pattern
- [ ] **PUBL-03**: Publish job warms Go module proxy via `andrewslotin/go-proxy-pull-action@v1.4.0` or equivalent
- [ ] **PUBL-04**: Publish job includes skip-if-already-published guard
- [ ] **PUBL-05**: Publish job outputs summary to `$GITHUB_STEP_SUMMARY` (matching Python/TypeScript pattern)
- [ ] **PUBL-06**: Publish job uses `actions/checkout@v6` with `fetch-tags: true`

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Coverage

- **COV-01**: Coverage reporting job with `go test -coverprofile`
- **COV-02**: Coverage threshold enforcement (e.g., 90%)

### Integration Testing

- **INTG-01**: Integration test job (when integration tests exist in Go SDK)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-compilation matrix | Library SDK, not a binary -- no artifact to cross-compile |
| Multiple OS matrix (Windows/macOS) | Pure Go, no CGO or OS-specific syscalls -- Linux-only is sufficient |
| GitHub Release creation | Go modules use tags + proxy, not GitHub Releases |
| Changelog automation | Separate concern; Python/TypeScript workflows also don't do this |
| goreleaser | Overkill for a library module; designed for binary releases |
| Exhaustive linter set (100+ linters) | Causes noise, false positives, slow CI -- practical subset is better |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| INFRA-01 | Phase 2 | Pending |
| INFRA-02 | Phase 2 | Pending |
| INFRA-03 | Phase 2 | Pending |
| INFRA-04 | Phase 2 | Pending |
| INFRA-05 | Phase 2 | Pending |
| INFRA-06 | Phase 2 | Pending |
| INFRA-07 | Phase 2 | Pending |
| INFRA-08 | Phase 2 | Pending |
| INFRA-09 | Phase 2 | Pending |
| LINT-01 | Phase 3 | Pending |
| LINT-02 | Phase 3 | Pending |
| LINT-03 | Phase 3 | Pending |
| LINT-04 | Phase 3 | Pending |
| TEST-01 | Phase 4 | Pending |
| TEST-02 | Phase 4 | Pending |
| TEST-03 | Phase 4 | Pending |
| TEST-04 | Phase 4 | Pending |
| BILD-01 | Phase 4 | Pending |
| BILD-02 | Phase 4 | Pending |
| BILD-03 | Phase 4 | Pending |
| PUBL-01 | Phase 5 | Pending |
| PUBL-02 | Phase 5 | Pending |
| PUBL-03 | Phase 5 | Pending |
| PUBL-04 | Phase 5 | Pending |
| PUBL-05 | Phase 5 | Pending |
| PUBL-06 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after initial definition*
