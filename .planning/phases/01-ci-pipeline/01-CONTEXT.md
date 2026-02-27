# Phase 1: CI Pipeline - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete GitHub Actions workflow (`sdk-go.yml`) and golangci-lint config (`.golangci.yml`) for the Go SDK at `sdks/go/`. Delivers lint, test matrix with race detection, coverage reporting, and a branch protection gate. No release automation, no cross-platform testing, no integration tests.

</domain>

<decisions>
## Implementation Decisions

### Go version matrix
- Test only currently supported Go releases: `['1.25.x', 'stable']` — one pinned, one auto-resolving
- Bump `go.mod` minimum from 1.21 to 1.25 to align declared minimum with tested versions
- `GOTOOLCHAIN=local` to prevent auto-upgrade during matrix runs
- Matrix update cadence: Claude's discretion on approach (manual vs automated)

### Workflow conventions
- File name: `sdk-go.yml` — matches sibling pattern (`sdk-typescript.yml`, `sdk-python.yml`)
- Job structure: 4 parallel jobs — `lint`, `test-matrix`, `coverage`, `ci-success` gate
- Gate job name: `ci-success` — generic, matches existing `ci.yml` pattern
- golangci-lint config: `sdks/go/.golangci.yml` — colocated with Go module

### Linter strictness
- Claude's discretion — not discussed; pick pragmatic defaults appropriate for a library SDK

### Claude's Discretion
- Linter selection and strictness in `.golangci.yml`
- Matrix update strategy (manual vs Dependabot)
- Exact golangci-lint version pin
- Coverage job Go version selection
- Step ordering within jobs

</decisions>

<specifics>
## Specific Ideas

- Follow sibling SDK workflow patterns (`sdk-python.yml`, `sdk-typescript.yml`) as closely as possible for consistency
- Research identified 8 critical pitfalls — all must be addressed in the workflow (path filter + required checks, golangci-lint v2 config format, working-directory in action with block, no CGO_ENABLED=0, -covermode=atomic with -race, -count=1 for test cache bypass, GOTOOLCHAIN=local, golangci-lint Go version compatibility)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-ci-pipeline*
*Context gathered: 2026-02-26*
