# Project Research Summary

**Project:** Logwell Go SDK CI/CD Workflow
**Domain:** GitHub Actions CI/CD for a Go subdirectory module in a multi-SDK monorepo
**Researched:** 2026-02-26
**Confidence:** HIGH

## Executive Summary

This project adds a GitHub Actions CI workflow (`sdk-go.yml`) for the Logwell Go SDK at `sdks/go/`. The Go module path is `github.com/Divkix/Logwell/sdks/go` — a subdirectory module in a monorepo that already ships Python and TypeScript SDK workflows. The established pattern is `lint -> test-unit -> build -> publish`, with path-filtered triggers, concurrency groups, and artifact uploads. The Go workflow must follow this pattern exactly while handling the fundamental differences between Go module publishing (git tag + proxy warming) versus Python/TypeScript registry-based publishing.

The recommended implementation is a single workflow file (`sdk-go.yml`) with four jobs running in the standard DAG: parallel lint/test/build, then publish gated on all three passing. The toolchain choices are fully locked down: `golangci/golangci-lint-action@v9` with golangci-lint v2.10.1, `actions/setup-go@v6` with built-in caching via `cache-dependency-path`, and `andrewslotin/go-proxy-pull-action@v1.4.0` for proxy warming. The race detector (`-race`) should be enabled on the test matrix because existing `client_test.go` has explicit concurrency tests. All action versions are pinned to prevent non-deterministic breaks.

The central risk in this project is Go subdirectory module specifics that do not exist in the Python/TypeScript workflows — wrong tag format kills proxy indexing silently, golangci-lint-action ignores job-level `defaults.run.working-directory`, and `setup-go` caching breaks without `cache-dependency-path`. These are all well-documented pitfalls with simple one-line fixes. The second major risk is copying the Python/TypeScript publish trigger pattern verbatim: Go modules publish on tag push (`sdks/go/vX.Y.Z`), not on every push to main. Getting this wrong causes the publish job to run on every PR merge with no valid version to index.

## Key Findings

### Recommended Stack

The GitHub Actions ecosystem for Go is mature and the right tools are unambiguous. The only meaningful decision was whether to use `actions/setup-go@v6` (current stable with node24 runtime, built-in module caching) vs older versions — v6 is correct. golangci-lint v2 is a breaking change from v1 with a mandatory config format change; the matching action version is v8 or v9, with v9 being current (also node24 runtime). Both action versions have been verified against GitHub releases pages as of February 2026.

**Core technologies:**
- `actions/checkout@v6`: Repo checkout — matches existing Python/TS workflows, do not diverge
- `actions/setup-go@v6`: Go toolchain + module cache — v6 is latest; `cache: true` is default, use `cache-dependency-path` for subdirectory
- `golangci/golangci-lint-action@v9`: Lint runner — official action, node24 runtime, requires golangci-lint v2+
- `golangci-lint v2.10.1`: Multi-linter runner — pinned version, v2 is a breaking format change from v1
- `andrewslotin/go-proxy-pull-action@v1.4.0`: Proxy warming on tag — handles subdirectory tag patterns natively
- Go matrix `[1.22, 1.23, 1.24]`: Test coverage — 1.22 is new minimum (bump from current 1.21 in go.mod)

### Expected Features

The research scope is narrow (a CI workflow file), so "features" map directly to workflow jobs and supporting files.

**Must have (table stakes):**
- Path-filtered triggers (`sdks/go/**` + workflow file) — workflow must not fire on every repo commit
- Concurrency group with `cancel-in-progress: true` — prevents pile-up; omitting is a regression vs existing SDKs
- golangci-lint job with `.golangci.yml` v2 config — industry standard; no config means no lint
- `go vet` coverage via golangci-lint default set — no separate step needed
- Unit test job with version matrix (1.22/1.23/1.24) — proves SDK works across supported range
- Race detector (`-race`) on test run — `client_test.go` has explicit concurrency tests
- Build verification job (`go build ./...`) — catches compile errors not covered by tests
- `needs: [lint, test-unit, build]` on publish — all three must gate publish
- Tag-based publish trigger (`sdks/go/v*`) — Go modules version via git tags, not file fields
- `workflow_dispatch` trigger — manual re-runs; already on both existing SDK workflows
- `timeout-minutes` on every job — prevents runaway jobs from burning CI minutes
- `defaults.run.working-directory: sdks/go` — scopes all `run:` steps to SDK subdirectory
- `.golangci.yml` at `sdks/go/` with `version: "2"` — required config file
- `go.mod` minimum version bump to 1.22 — current 1.21 doesn't match the matrix floor

**Should have (differentiators):**
- `go mod tidy` verification in lint job — catches stale `go.sum` before it hits the proxy
- Job summary output in publish job — matches quality of existing Python/TypeScript workflows
- Skip-if-already-published guard — prevents confusing re-index noise

**Defer (v2+):**
- Coverage reporting job — no tooling exists yet; separate milestone
- Integration test job — no integration tests exist in `sdks/go/`; adding them is out of scope

### Architecture Approach

The workflow architecture is a standard DAG of four jobs. The three quality-gate jobs (lint, test-unit, build) run in parallel with no interdependencies. The publish job sits behind all three via `needs:`. This is identical to the Python and TypeScript workflow structure, deliberately so — diverging from the established pattern without reason creates maintenance overhead. The only structural difference is the publish trigger: tag-based rather than branch-based, because Go modules have no registry to upload to; the tag itself is the release artifact.

**Major components:**
1. **Workflow skeleton** — triggers (push/PR paths, tag push, workflow_dispatch), concurrency group, permissions, working-directory default
2. **Lint job** — `actions/checkout@v6`, `setup-go@v6` (stable, cache:false), `golangci-lint-action@v9` (with explicit `working-directory: sdks/go`), `go mod tidy` verification
3. **Test-unit job** — `setup-go@v6` with matrix [1.22/1.23/1.24] and `cache-dependency-path`, `go test -race -v ./...`
4. **Build job** — `setup-go@v6` (1.24), `go build ./...`, `go vet ./...`
5. **Publish job** — `needs: [lint, test-unit, build]`, tag-gated, `fetch-tags: true`, proxy warming via `go-proxy-pull-action@v1.4.0`, job summary to `$GITHUB_STEP_SUMMARY`
6. **`.golangci.yml`** — v2 format config at `sdks/go/`, linter set: `govet`, `errcheck`, `staticcheck`, `ineffassign`, `unused`

### Critical Pitfalls

1. **Wrong tag format breaks proxy indexing silently** — Use `sdks/go/vX.Y.Z` tags, not bare `v*`. The workflow trigger must be `on.push.tags: ['sdks/go/v*']`. A wrong tag causes proxy 404 but CI exits 0.

2. **golangci-lint-action ignores job-level `defaults.run.working-directory`** — The action runs from repo root unless you pass `working-directory: sdks/go` directly in the action's `with:` block. `defaults.run.working-directory` only applies to `run:` steps, not to composite/JS actions.

3. **golangci-lint v1 config fails under v2** — `.golangci.yml` must start with `version: "2"`. Copying v1 config from the internet produces either hard parse failures or silently ignored exclusion rules. Removed linters (`deadcode`, `golint`, `scopelint`) cause hard errors.

4. **`setup-go` cache silently misses subdirectory `go.sum`** — Without `cache-dependency-path: sdks/go/go.sum`, setup-go looks for `go.sum` at the repo root, finds nothing, and caching is disabled without error. Every run re-downloads all dependencies.

5. **Publish job copied from Python/TypeScript triggers on every main push** — Go publish must be gated on `startsWith(github.ref, 'refs/tags/sdks/go/v')`, not `github.ref == 'refs/heads/main'`. Python/TypeScript check for version file changes; Go has no version file — the tag is the version.

## Implications for Roadmap

Based on research, the implementation is a linear dependency chain with clear sequencing. The phases below reflect the natural build order — each unblocks the next.

### Phase 1: Foundation Files
**Rationale:** Both the workflow file and the golangci-lint config must exist before any CI job can run. The go.mod bump is a one-line change that unblocks the version matrix. These are prerequisite files with zero runtime risk.
**Delivers:** `sdks/go/.golangci.yml` (v2 format), go.mod version bumped to 1.22
**Addresses:** Table-stakes lint config requirement; matrix floor alignment
**Avoids:** Pitfall 3 (v1 config under v2 lint action), Pitfall 1 (go.mod/matrix mismatch)

### Phase 2: Workflow Skeleton
**Rationale:** The trigger/concurrency/defaults infrastructure must exist before adding jobs. This phase produces a valid-but-empty workflow file that can be committed and reviewed independently.
**Delivers:** `.github/workflows/sdk-go.yml` with triggers, concurrency group, permissions, `defaults.run.working-directory`
**Uses:** Path filters `sdks/go/**`, tag filter `sdks/go/v*`, concurrency key `sdk-go-${{ github.workflow }}-...`
**Avoids:** Pitfall 8 (wrong publish trigger), Pitfall 10 (concurrency collision with other SDK workflows)

### Phase 3: Lint Job
**Rationale:** Lint is the first quality gate and has the most subdirectory-specific gotchas. Getting it right first confirms the action configuration is correct before adding more jobs.
**Delivers:** Functional lint job with golangci-lint v2.10.1, `go mod tidy` verification
**Uses:** `golangci-lint-action@v9`, `setup-go@v6` with `cache: false`
**Implements:** Lint job component
**Avoids:** Pitfall 2 (working-directory not propagated to action), Pitfall 4 (Go version mismatch in lint binary)

### Phase 4: Test and Build Jobs
**Rationale:** Test and build jobs have fewer gotchas and follow straightforward patterns once the foundation is in place. The race detector is critical for the existing concurrency tests.
**Delivers:** Test-unit job (matrix 1.22/1.23/1.24 with `-race`), build job (`go build ./...` + `go vet ./...`)
**Uses:** `setup-go@v6` with `cache-dependency-path: sdks/go/go.sum`
**Implements:** Test-unit and build components
**Avoids:** Pitfall 5 (cache miss due to missing `cache-dependency-path`), Pitfall 6 (tests running from wrong directory), Pitfall 9 (`fail-fast: false` on matrix)

### Phase 5: Publish Job
**Rationale:** Publish is last because it gates on all three prior jobs passing, and its behavior (proxy warming) can only be validated with a real tag push. The skip-guard and job summary are quality-of-life additions consistent with existing SDK workflows.
**Delivers:** Publish job with proxy warming, skip guard, `$GITHUB_STEP_SUMMARY` output
**Uses:** `go-proxy-pull-action@v1.4.0`, `fetch-tags: true` on checkout
**Implements:** Publish component
**Avoids:** Pitfall 1 (wrong tag format), Pitfall 7 (stale go.sum not caught), Pitfall 8 (publish triggering on non-tag push)

### Phase Ordering Rationale

- Foundation files must precede the workflow because the lint action hard-fails without `.golangci.yml`.
- Workflow skeleton before jobs because jobs reference skeleton-level config (concurrency, working-directory).
- Lint before test/build because it has the highest density of subdirectory-specific gotchas — validating it first de-risks the rest.
- Publish last because it is gated on the other jobs and requires a tag to test end-to-end.
- This order also matches the explicit `Suggested Build Order` from ARCHITECTURE.md, cross-validated by the `MVP Recommendation` in FEATURES.md.

### Research Flags

Phases with standard patterns (skip deeper research):
- **Phase 1 (Foundation Files):** Well-documented Go/golangci-lint configuration with verified v2 schema. No research needed.
- **Phase 2 (Workflow Skeleton):** Direct copy of existing `sdk-python.yml` / `sdk-typescript.yml` pattern with documented adaptations.
- **Phase 3 (Lint Job):** Official golangci-lint-action README covers the working-directory fix explicitly.
- **Phase 4 (Test/Build Jobs):** Standard Go CI patterns, well-documented in GitHub Actions official Go guide.

Phases likely needing validation during implementation:
- **Phase 5 (Publish Job):** End-to-end proxy warming can only be validated with a real `sdks/go/vX.Y.Z` tag push. The skip guard logic needs manual testing. Consider using a test tag (`sdks/go/v0.0.1-test`) in a branch before merging.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All action versions verified against GitHub releases pages, Feb 2026. golangci-lint v2.10.1 confirmed as latest stable. |
| Features | HIGH | Derived directly from existing `sdk-python.yml` and `sdk-typescript.yml` in this repo. Patterns are established and the deviations (Go tag-based vs file-based publish) are well-documented. |
| Architecture | HIGH | Job DAG is a direct extension of existing patterns. Subdirectory module gotchas are documented in official Go reference and golangci-lint-action issue tracker. |
| Pitfalls | HIGH | All critical pitfalls sourced from official documentation (Go Modules Reference, golangci-lint migration guide, setup-go README). Pitfall 2 has a specific open issue number (#369). |

**Overall confidence:** HIGH

### Gaps to Address

- **golangci-lint version pinning strategy:** Research recommends pinning to `v2.10.1` but leaves open whether to pin in the action `with:` block or in `.golangci.yml`. Both are valid; action `with:` is simpler. Decide at implementation time.
- **Publish trigger design:** ARCHITECTURE.md notes an open question — should publish trigger on tag push events or detect tags on HEAD during main branch push? Research leans toward tag push events (`on.push.tags: ['sdks/go/v*']`) as the cleaner design. Confirm this aligns with how the team intends to release.
- **Initial version tag:** The Go module has no published version yet. First release will require creating `sdks/go/v0.1.0` (or equivalent) to validate the full publish pipeline end-to-end.

## Sources

### Primary (HIGH confidence)

- [golangci-lint-action releases](https://github.com/golangci/golangci-lint-action/releases) — v9 confirmed current
- [golangci-lint releases](https://github.com/golangci/golangci-lint/releases) — v2.10.1 confirmed Feb 17, 2026
- [actions/setup-go releases](https://github.com/actions/setup-go/releases) — v6.3.0 confirmed current; `cache-dependency-path` documented
- [golangci-lint v2 configuration docs](https://golangci-lint.run/docs/configuration/file/) — `version: "2"` schema, field renames from v1
- [golangci-lint migration guide v1 to v2](https://golangci-lint.run/docs/product/migration-guide/) — deprecated linter list
- [golangci-lint-action issue #369](https://github.com/golangci/golangci-lint-action/issues/369) — `working-directory` not inherited from job defaults
- [Go Modules Reference: VCS version tags for subdirectories](https://go.dev/ref/mod#vcs-version) — `sdks/go/vX.Y.Z` tag format
- [Publishing Go Modules (official Go blog)](https://go.dev/blog/publishing-go-modules) — proxy warming procedure
- [GitHub Actions: Building and testing Go](https://docs.github.com/en/actions/use-cases-and-examples/building-and-testing/building-and-testing-go) — setup-go usage patterns
- Existing `sdk-python.yml` and `sdk-typescript.yml` in this repo — job structure, concurrency pattern, artifact versions

### Secondary (MEDIUM confidence)

- [andrewslotin/go-proxy-pull-action v1.4.0](https://github.com/andrewslotin/go-proxy-pull-action) — proxy warming action; v1.4.0 released Feb 2, 2026. MEDIUM because this is a third-party action not from GitHub or golangci.
- [pkg.go.dev about page](https://pkg.go.dev/about) — proxy indexing trigger behavior

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
