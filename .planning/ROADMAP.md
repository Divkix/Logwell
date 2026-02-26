# Roadmap: Logwell Go SDK CI Workflow

## Overview

Five phases build the `sdk-go.yml` GitHub Actions workflow from the ground up: foundation files first (lint config + go.mod bump), then workflow skeleton, then each quality-gate job in dependency order, ending with the tag-gated publish job. Each phase is independently reviewable and unblocks the next. The end state is a Go SDK CI pipeline with identical structural patterns to the existing Python and TypeScript SDK workflows.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Foundation Files** - golangci-lint v2 config and go.mod version bump
- [ ] **Phase 2: Workflow Skeleton** - Triggers, concurrency, permissions, working-directory defaults
- [ ] **Phase 3: Lint Job** - golangci-lint-action with subdirectory-aware config and go mod tidy check
- [ ] **Phase 4: Test and Build Jobs** - Version-matrix unit tests with race detector and build verification
- [ ] **Phase 5: Publish Job** - Tag-gated proxy warming with skip guard and job summary

## Phase Details

### Phase 1: Foundation Files
**Goal**: Prerequisite files exist so the lint action and version matrix can run without hard failures
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02
**Success Criteria** (what must be TRUE):
  1. `sdks/go/.golangci.yml` exists with `version: "2"` at the top and the practical linter set (govet, errcheck, staticcheck, ineffassign, unused) enabled
  2. `sdks/go/go.mod` declares `go 1.22` as the minimum version
  3. Running `golangci-lint run` locally against `sdks/go/` resolves the config without parse errors
**Plans:** 1 plan

Plans:
- [ ] 01-01-PLAN.md — Create golangci-lint v2 config and bump go.mod to go 1.22

### Phase 2: Workflow Skeleton
**Goal**: A valid, committable `sdk-go.yml` workflow file exists with all trigger and infrastructure config, no jobs yet
**Depends on**: Phase 1
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, INFRA-09
**Success Criteria** (what must be TRUE):
  1. `.github/workflows/sdk-go.yml` exists and passes `actionlint` / GitHub Actions schema validation
  2. Workflow triggers only on `sdks/go/**` and `.github/workflows/sdk-go.yml` path changes (not on every repo push)
  3. Workflow triggers on tag push matching `sdks/go/v*` for the publish path
  4. `workflow_dispatch` is present for manual re-runs
  5. Concurrency group `sdk-go-...` with `cancel-in-progress: true` is defined and `defaults.run.working-directory: sdks/go` is set at workflow level
**Plans**: TBD

### Phase 3: Lint Job
**Goal**: The lint job runs golangci-lint v2 against the Go SDK subdirectory and fails if go.mod/go.sum are stale
**Depends on**: Phase 2
**Requirements**: LINT-01, LINT-02, LINT-03, LINT-04
**Success Criteria** (what must be TRUE):
  1. Lint job uses `golangci/golangci-lint-action@v9` with a pinned golangci-lint version and explicit `working-directory: sdks/go` in the action `with:` block (not relying on job defaults)
  2. Lint job includes `setup-go@v6` before the lint action
  3. A `go mod tidy && git diff --exit-code go.mod go.sum` step is present and would fail on a dirty go.sum
  4. Lint job completes successfully against the current `sdks/go/` source on a passing PR
**Plans**: TBD

### Phase 4: Test and Build Jobs
**Goal**: Unit tests run across Go 1.22/1.23/1.24 with the race detector, and a build verification job confirms the SDK compiles cleanly
**Depends on**: Phase 3
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, BILD-01, BILD-02, BILD-03
**Success Criteria** (what must be TRUE):
  1. Test job runs `go test -race -v ./...` across all three Go versions (1.22, 1.23, 1.24) in a matrix
  2. Test matrix uses `strategy.fail-fast: false` so all versions report independently
  3. `setup-go@v6` in the test job specifies `cache-dependency-path: sdks/go/go.sum` to enable caching for the subdirectory module
  4. Build job runs `go build ./...` and `go vet ./...` using the latest stable Go version and passes against the current source
**Plans**: TBD

### Phase 5: Publish Job
**Goal**: The publish job warms the Go module proxy for new `sdks/go/vX.Y.Z` tags, guarded by all three quality gates passing and a skip-if-already-published check
**Depends on**: Phase 4
**Requirements**: PUBL-01, PUBL-02, PUBL-03, PUBL-04, PUBL-05, PUBL-06
**Success Criteria** (what must be TRUE):
  1. Publish job lists `needs: [lint, test-unit, build]` and does not run unless all three pass
  2. Publish job only executes when `github.ref` starts with `refs/tags/sdks/go/v` (not on main branch pushes)
  3. `actions/checkout@v6` in the publish job uses `fetch-tags: true`
  4. Proxy warming step uses `andrewslotin/go-proxy-pull-action@v1.4.0` (or equivalent) and includes a skip-if-already-published guard
  5. Publish job writes a summary to `$GITHUB_STEP_SUMMARY` matching the pattern from Python/TypeScript SDK workflows
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation Files | 0/1 | Planned | - |
| 2. Workflow Skeleton | 0/? | Not started | - |
| 3. Lint Job | 0/? | Not started | - |
| 4. Test and Build Jobs | 0/? | Not started | - |
| 5. Publish Job | 0/? | Not started | - |
