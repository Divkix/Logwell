---
phase: 01-foundation-files
plan: 01
subsystem: infra
tags: [golangci-lint, go-modules, ci-config, linting]

# Dependency graph
requires:
  - phase: none
    provides: first phase, no dependencies
provides:
  - golangci-lint v2 configuration file at sdks/go/.golangci.yml
  - go.mod minimum version bumped to go 1.22
affects: [02-workflow-skeleton, 03-lint-job, 04-test-and-build-jobs]

# Tech tracking
tech-stack:
  added: [golangci-lint v2]
  patterns: [v2 config with explicit linter list and separate formatters section]

key-files:
  created: [sdks/go/.golangci.yml]
  modified: [sdks/go/go.mod]

key-decisions:
  - "Used linters.default: none with explicit enable list per FOUND-02 (not linters.default: standard)"
  - "Formatters (gofmt, goimports) placed under formatters.enable per v2 schema (not linters.enable)"
  - "go 1.22 language version form (no patch suffix) for minimum version declaration"

patterns-established:
  - "golangci-lint v2 config: version '2' header mandatory, formatters separate from linters"

requirements-completed: [FOUND-01, FOUND-02]

# Metrics
duration: 1min
completed: 2026-02-26
---

# Phase 1 Plan 01: Foundation Files Summary

**golangci-lint v2 config with practical linter set (govet, errcheck, staticcheck, ineffassign, unused) and gofmt/goimports formatters, plus go.mod bumped from go 1.21 to go 1.22**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-26T22:59:39Z
- **Completed:** 2026-02-26T23:00:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `sdks/go/.golangci.yml` with `version: "2"`, five practical linters, and gofmt/goimports formatters in the v2 formatters section
- Bumped `sdks/go/go.mod` from `go 1.21` to `go 1.22` (language version form, no patch suffix)
- Validated golangci-lint config parses without schema errors (existing code has typecheck issues from test helpers — Phase 3 scope)
- Ran `go mod tidy` to keep go.sum in sync (no-op since no external deps)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create golangci-lint v2 config and bump go.mod minimum version** - `95ee986` (feat)
2. **Task 2: Validate golangci-lint config parses without errors** - validation-only, no file changes

## Files Created/Modified
- `sdks/go/.golangci.yml` - golangci-lint v2 config with version "2", five linters, and two formatters
- `sdks/go/go.mod` - Bumped minimum Go version from 1.21 to 1.22

## Decisions Made
- Used `linters.default: none` with explicit enable list rather than `linters.default: standard` to satisfy FOUND-02's requirement for explicitly listed linters
- Placed gofmt and goimports under `formatters.enable` (v2 schema) not `linters.enable` (v1 pattern)
- Used `go 1.22` language version form without patch suffix — canonical form for library module minimum declarations

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- golangci-lint reports typecheck errors in existing test helper code (`client_test_helpers.go` references `testServer` and `validAPIKey` which are undefined in the non-test build context). This is an existing code issue, not a config problem. Phase 1 success criteria only requires the config to parse without schema errors. Lint compliance is Phase 3 scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Foundation files in place: `.golangci.yml` and `go.mod` ready for Phase 2 (Workflow Skeleton) and Phase 3 (Lint Job)
- No blockers for next phase

---
*Phase: 01-foundation-files*
*Completed: 2026-02-26*
