# Project Research Summary

**Project:** Logwell Go SDK CI Pipeline
**Domain:** GitHub Actions CI workflow for a Go library in a monorepo
**Researched:** 2026-02-26
**Confidence:** HIGH

## Executive Summary

The Logwell Go SDK is a zero-dependency, stdlib-only Go library targeting Go 1.21+, living in a monorepo alongside a SvelteKit application and sibling Python/TypeScript SDK CI workflows. Building a Go SDK CI pipeline in this context is a well-understood problem with established patterns — the main challenge is not figuring out what to do but executing it without falling into a handful of non-obvious integration traps specific to monorepos and the golangci-lint toolchain.

The recommended approach is a three-job parallel workflow: a `lint` job using `golangci-lint-action@v9` with golangci-lint v2, a `test-matrix` job running `go test -race -count=1 -covermode=atomic ./...` against Go 1.25.x and 1.26.x (the two supported releases as of Feb 2026, with 1.24 EOL as of Feb 11, 2026), and a `coverage` job that writes results to `$GITHUB_STEP_SUMMARY`. These three jobs feed into a `ci-success` aggregator gate that is the sole required status check registered in branch protection. This structure exactly mirrors the pattern already used in `sdk-python.yml` and `sdk-typescript.yml`, making it immediately familiar to anyone in the project.

The critical risks are configuration-level traps that produce silent failures or wrong behavior: the golangci-lint-action ignoring job-level `defaults.run.working-directory` (must be set explicitly in the action's `with:` block), the Go toolchain auto-upgrading during matrix runs and defeating version compatibility testing (fixed with `GOTOOLCHAIN: local`), path-filtered workflows permanently blocking PRs that touch only non-Go files if registered as a required check (fixed by the `ci-success` aggregator pattern), and stale test results from the Go test cache masking real failures (fixed with `-count=1`). All eight identified pitfalls address issues that will bite immediately if ignored.

## Key Findings

### Recommended Stack

The stack is entirely composed of official or project-standard GitHub Actions. `actions/checkout@v6` and `actions/upload-artifact@v6` match every existing workflow in the repo. `actions/setup-go@v6` (released Feb 26, 2026) is the current version with Node 24 runtime and native `toolchain` directive support. `golangci/golangci-lint-action@v9` is the official action from the golangci maintainers, running golangci-lint v2 (the mandatory version for new projects — v1 is EOL). No external services, no tokens, no accounts required.

**Core technologies:**
- `actions/checkout@v6`: Repo checkout — matches all existing monorepo workflows
- `actions/setup-go@v6`: Go toolchain installation + module/build cache — handles `cache-dependency-path` for nested monorepo modules
- `golangci/golangci-lint-action@v9`: Comprehensive static analysis via golangci-lint v2 — official action, handles caching, produces PR annotations
- Go stdlib test tools (`go test -race`, `go vet`, `go tool cover`): Testing, vetting, and coverage — zero external dependencies
- `$GITHUB_STEP_SUMMARY`: Coverage reporting — no external service, visible in PR UI

**Version notes:**
- Go matrix: `[1.25.x, 1.26.x]` only — Go 1.24 EOL Feb 11, 2026; testing EOL versions is theater
- golangci-lint: pin to `v2.10.1` or `v2` — never use implicit latest
- `.golangci.yml` must have top-level `version: "2"` — v1 format is rejected by v2 binary

### Expected Features

All P1 features are low-complexity and collectively constitute the minimum viable pipeline. The pipeline is either complete (all P1 features present) or insufficient. There is no viable partial subset.

**Must have (table stakes):**
- Path filtering (`sdks/go/**` + `.github/workflows/sdk-go.yml`) — without this every frontend commit triggers Go CI
- `defaults.run.working-directory: sdks/go` — all `run:` steps execute from the correct module root
- `go test -race -count=1 -covermode=atomic ./...` — race detector is non-negotiable for a library with concurrent internals
- `golangci-lint` with pinned version via official action — comprehensive linting in one step
- Go module cache via `actions/setup-go` `cache-dependency-path: sdks/go/go.sum` — prevents full recompile on every run
- Coverage report to `$GITHUB_STEP_SUMMARY` — no external service, zero config
- `ci-success` aggregator gate job — single required status check for branch protection
- `timeout-minutes: 10` on all jobs — prevents runaway runners
- `workflow_dispatch` trigger — manual re-runs without a code push
- Concurrency group with `cancel-in-progress: true` — prevents queue buildup

**Should have (v1.x additions after baseline is trusted):**
- `govulncheck` job (scheduled weekly + on PRs) — official Go vulnerability scanner; no tokens needed
- `go mod tidy` drift check — catches forgotten `go mod tidy` before they accumulate
- Coverage threshold enforcement — set only after measuring the actual baseline

**Defer (v2+):**
- `gotestsum` for structured test output — adds a dependency; evaluate if log readability becomes painful
- Release automation — separate concern, separate workflow; `pkg.go.dev` publishes via git tag push

**Anti-features (explicitly avoid):**
- Cross-platform matrix (Windows/macOS) — pure Go stdlib library, platform differences irrelevant, triples cost
- goreleaser — this is a library, not a binary distribution; Go modules publish via tag with no tooling
- Codecov/Coveralls — requires external account, tokens, maintenance; `$GITHUB_STEP_SUMMARY` is sufficient

### Architecture Approach

The workflow is structured as four jobs: `lint` and `test-matrix` run in parallel with no `needs:` dependency between them, `coverage` runs independently on a single Go version, and `ci-success` aggregates all three with `if: always()`. This four-job structure is identical to the shape of `sdk-python.yml` (lint + test + coverage + implicit gate). The `defaults.run.working-directory: sdks/go` block eliminates per-step working directory repetition for all `run:` steps, while `golangci-lint-action` receives `working-directory` explicitly in its `with:` block (it does not inherit job defaults).

**Major components:**
1. `on.paths` trigger filter — ensures workflow fires only on `sdks/go/**` or the workflow file itself; never on SvelteKit or Python changes
2. `lint` job — `golangci/golangci-lint-action@v9` with `version: v2`, `working-directory: sdks/go`, `.golangci.yml` config in `sdks/go/`
3. `test-matrix` job — `actions/setup-go@v6` matrix over `[1.25.x, 1.26.x]`, `go vet ./...` + `go test -v -race -count=1 ./...`, `fail-fast: false`
4. `coverage` job — single Go version (`stable`), `go test -race -count=1 -covermode=atomic -coverprofile=coverage.out ./...`, output to step summary, artifact upload via `actions/upload-artifact@v6`
5. `ci-success` gate — `needs: [lint, test-matrix, coverage]`, `if: always()`, explicit result checks for each upstream job

### Critical Pitfalls

1. **Path filter + required status checks blocks PRs** — When `sdk-go.yml` is registered as a required check in branch protection and only uses `paths:` triggers, any PR touching only non-Go files results in a permanent "Pending" status. Fix: use a `ci-success` aggregator job with `if: always()` and register only that job as the required check. This pattern is already used in `ci.yml`.

2. **golangci-lint-action ignores `defaults.run.working-directory`** — The action does not inherit the job's `defaults.run.working-directory`. Running without explicit `working-directory: sdks/go` in the action's `with:` block causes "can't load package" errors or lints the wrong module. Also requires `--path-mode=abs` in `args` for correct PR annotations.

3. **Go toolchain auto-upgrade defeats matrix version testing** — Since Go 1.21, presence of a `toolchain` directive in `go.mod` or any required module causes `go` to download a newer toolchain, making the matrix lie about what version was tested. Fix: set `GOTOOLCHAIN: local` in workflow `env:` from the start.

4. **`-covermode=count` (default) is incompatible with `-race`** — The coverage instrumentation inserts plain integer writes that trigger the race detector. Fix: always use `-covermode=atomic` when combining coverage with race detection. The correct command is `go test -race -count=1 -covermode=atomic -coverprofile=coverage.out ./...`.

5. **Go test cache serves stale PASS results** — For a stdlib-only SDK, `go.sum` is empty or near-empty, making cache keys based on `go.sum` constant across all runs. The Go test cache serves `PASS` results without re-running tests. Fix: `-count=1` on all `go test` invocations in CI.

## Implications for Roadmap

Based on research, the entire deliverable is a single coherent artifact — a GitHub Actions workflow file plus a golangci-lint config file. There is no meaningful way to ship a partial pipeline; it is correct and complete or it is not. That said, the implementation naturally divides into two work phases.

### Phase 1: Core CI Workflow (sdk-go.yml + .golangci.yml)

**Rationale:** The workflow file and linter config are co-dependent — the workflow calls the linter, the linter requires the config. Both must exist and be correct before any CI value is delivered. This is the entire MVP.

**Delivers:** A functional CI pipeline that runs on every push/PR touching `sdks/go/`, lints with golangci-lint v2, tests against two supported Go versions with race detection, reports coverage to PR summaries, and provides a stable required status check for branch protection.

**Addresses features:**
- All P1 features from FEATURES.md (path filtering, working-directory default, go test -race, golangci-lint, module cache, coverage summary, ci-success gate, timeouts, workflow_dispatch, concurrency)

**Avoids pitfalls:**
- Pitfall 1 (path filter + required checks): `ci-success` aggregator from day one
- Pitfall 2 (golangci-lint v1/v2 mismatch): write `.golangci.yml` with `version: "2"` from the start
- Pitfall 3 (lint working-directory): `working-directory: sdks/go` + `--path-mode=abs` in action `with:` block
- Pitfall 4 (CGO_ENABLED=0 breaks race detector): no global `CGO_ENABLED=0`
- Pitfall 5 (-covermode=count + -race): use `-covermode=atomic` always
- Pitfall 6 (stale test cache): `-count=1` on all test invocations
- Pitfall 7 (toolchain auto-upgrade): `GOTOOLCHAIN: local` in workflow `env:`
- Pitfall 8 (golangci-lint Go version mismatch): pin explicit version compatible with project's Go directive

### Phase 2: Security and Quality Hardening (v1.x additions)

**Rationale:** These additions provide meaningful value but are not required for the pipeline to be functional. They should be added once Phase 1 is trusted and the actual coverage baseline is known.

**Delivers:** Automated vulnerability scanning via `govulncheck` on a weekly schedule and on PRs, `go mod tidy` drift detection to catch forgotten module hygiene, and a coverage threshold gate set from the measured baseline.

**Uses:** `golang/govulncheck-action` (official Go team action), inline shell script for tidy check, inline awk for threshold enforcement — no new action dependencies required.

### Phase Ordering Rationale

- Phase 1 must be complete before Phase 2 because the threshold gate requires a measured baseline; setting an arbitrary 80% floor before measuring is explicitly flagged as an anti-pattern in the research.
- There is no Phase 3 value available for this scope — release automation (`goreleaser`, `pkg.go.dev` publish) is explicitly out of scope per `PROJECT.md` and does not belong in this workflow.
- The Phase 1 structure (4 jobs: lint, test-matrix, coverage, ci-success) is not decomposable — all 4 must land in a single PR to produce a working pipeline.

### Research Flags

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1:** All patterns are directly observable from sibling SDK workflows in this repository and verified against official action repositories. No ambiguity. The implementation is a straightforward composition of established patterns.
- **Phase 2:** `govulncheck` integration is documented by the official Go team action. `go mod tidy` drift check is a one-liner. Coverage threshold enforcement is a single awk invocation. No research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All action versions verified against GitHub releases Feb 2026; Go EOL dates verified via endoflife.date; golangci-lint v2.10.1 confirmed as latest |
| Features | HIGH | Derived directly from existing sibling workflows in the same repo plus official documentation; no speculation |
| Architecture | HIGH | All patterns observed in existing `sdk-python.yml`, `sdk-typescript.yml`, `ci.yml` in this repo plus verified against official action READMEs |
| Pitfalls | HIGH | All pitfalls backed by official GitHub issue trackers, Go issue tracker, or official docs; multiple corroborating sources for each |

**Overall confidence:** HIGH

### Gaps to Address

- **Go matrix versions:** Research recommends `[1.25.x, 1.26.x]` based on current EOL state (1.24 EOL Feb 11, 2026). The existing `PROJECT.md` and codebase target Go 1.21 as minimum. There is a mismatch between the declared minimum (1.21) and what's worth testing in the matrix (current supported releases only). The matrix should reflect what's testable in practice, not the `go.mod` minimum. This is a deliberate recommendation, not a gap — but it should be explicitly validated against project stakeholder expectations during Phase 1 implementation.

- **golangci-lint version pinning:** Research recommends pinning to `v2.10.1` (current as of research date). The specific pin will drift over time. Dependabot config for the Go Actions ecosystem should be verified or added to catch this automatically.

- **Coverage baseline:** Phase 2 coverage threshold enforcement requires knowing the actual coverage percentage before setting a floor. This number is not knowable until Phase 1 is running. Do not set a threshold before measuring.

## Sources

### Primary (HIGH confidence)

- `https://github.com/actions/setup-go/releases` — v6.3.0 confirmed current (Feb 26, 2026)
- `https://github.com/golangci/golangci-lint-action/releases` — v9.2.0 confirmed current; Node 24 runtime
- `https://github.com/golangci/golangci-lint/releases` — v2.10.1 confirmed current (Feb 17, 2026)
- `https://endoflife.date/go` — Go 1.24 EOL Feb 11, 2026; 1.25 and 1.26 current supported majors
- `https://golangci-lint.run/docs/configuration/file/` — v2 config format requires `version: "2"`
- `.github/workflows/sdk-typescript.yml` — action version baseline, workflow structure patterns
- `.github/workflows/sdk-python.yml` — job decomposition pattern (lint + test + coverage)
- `.github/workflows/ci.yml` — `ci-success` aggregator pattern, action versions
- `https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks` — path filter + required check behavior
- `https://go.dev/doc/articles/race_detector` — race detector CGO requirement
- `https://github.com/golangci/golangci-lint-action/issues/369` — working-directory not respected
- `https://github.com/golangci/golangci-lint/issues/5641` — Go version mismatch error

### Secondary (MEDIUM confidence)

- `https://github.com/mvdan/github-actions-golang` — GOTOOLCHAIN=local recommendation for matrix testing
- `https://gist.github.com/maratori/47a4d00457a92aa426dbd48a18776322` — golangci-lint config rationale
- `https://brandur.org/fragments/go-version-matrix` — matrix version testing correctness
- `https://hermanschaaf.com/running-the-go-race-detector-with-cover/` — -covermode=atomic with -race
- `https://oneuptime.com/blog/post/2025-12-20-go-ci-pipeline-github-actions/view` — Go CI pipeline patterns
- `https://ldez.github.io/blog/2025/03/23/golangci-lint-v2/` — golangci-lint v2 migration guide

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
