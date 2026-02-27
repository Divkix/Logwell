# Roadmap: Logwell Go SDK CI

## Overview

One coherent artifact — a GitHub Actions workflow (`sdk-go.yml`) and its golangci-lint config (`.golangci.yml`) — delivers the entire CI pipeline for the Go SDK. All 19 requirements feed into this single deliverable; there is no viable partial subset. The pipeline is either complete and correct or it provides no value.

## Phases

- [ ] **Phase 1: CI Pipeline** - Complete GitHub Actions workflow with lint, test matrix, coverage, and branch protection gate

## Phase Details

### Phase 1: CI Pipeline
**Goal**: Every push and pull request touching `sdks/go/` is automatically linted, tested across supported Go versions with race detection, and coverage-reported — with a stable required status check for branch protection
**Depends on**: Nothing (first phase)
**Requirements**: TRIG-01, TRIG-02, TRIG-03, TRIG-04, LINT-01, LINT-02, LINT-03, LINT-04, TEST-01, TEST-02, TEST-03, TEST-04, COV-01, COV-02, COV-03, INFR-01, INFR-02, INFR-03, INFR-04
**Success Criteria** (what must be TRUE):
  1. A push to main touching `sdks/go/` triggers the workflow; a push touching only SvelteKit files does not
  2. A pull request shows lint annotations from golangci-lint v2 in the diff view and fails if lint errors exist
  3. The test matrix runs on Go 1.25.x and Go 1.26.x with race detection enabled; both matrix legs report independently; one failure does not suppress the other
  4. After a successful run, the PR summary shows a coverage percentage and a `coverage.out` artifact is downloadable from the Actions run
  5. A PR touching only non-Go files still receives a green `ci-success` check and is not permanently blocked
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CI Pipeline | 0/? | Not started | - |
