# Feature Landscape

**Domain:** Go SDK CI/CD Workflow (GitHub Actions)
**Researched:** 2026-02-26

## Context

This is a subsequent milestone adding a CI workflow to an existing Go SDK (`sdks/go/`). The project already has Python and TypeScript SDK workflows (`sdk-python.yml`, `sdk-typescript.yml`) that establish the baseline pattern: lint -> test-unit -> build -> publish, with path-filtered triggers, concurrency groups, and `actions/upload-artifact@v6`.

The Go module path is `github.com/Divkix/Logwell/sdks/go`, a subdirectory module. Tags must follow the `sdks/go/vX.Y.Z` format for Go module proxy indexing. There are no integration tests in the Go SDK -- only unit tests.

---

## Table Stakes

Features users expect. Missing = CI is useless or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Path-filtered triggers** | Workflow must not fire on every repo commit -- only changes to `sdks/go/**` or the workflow file itself | Low | Match existing `sdk-python.yml` / `sdk-typescript.yml` pattern exactly |
| **Concurrency group with cancel-in-progress** | Prevents pile-up on fast-moving branches / PRs | Low | Pattern already established; omitting it is a regression |
| **golangci-lint job** | Industry-standard linter aggregator for Go; covers `go vet`, `staticcheck`, `errcheck`, and more with a single action | Low | Use `golangci/golangci-lint-action@v9` (latest, requires node24); supply a `.golangci.yml` config file |
| **`go vet` via golangci-lint** | Compiler-level static analysis; catches suspicious code constructs that aren't syntax errors | Low | golangci-lint runs `govet` by default -- no separate step needed if golangci-lint is configured |
| **Unit test job with version matrix** | Tests must prove the SDK works across Go 1.22, 1.23, 1.24 -- the supported range declared in go.mod | Medium | Use `actions/setup-go@v5`; matrix on `go-version: [1.22, 1.23, 1.24]`; run `go test -v ./...` |
| **Build verification job** | Proves the package compiles (`go build ./...`) without requiring a runtime environment | Low | Catches import cycles, missing symbols, type errors not caught by tests |
| **Dependency sequencing (needs:)** | publish must only run after lint + test + build pass | Low | Same job DAG as existing workflows: publish `needs: [lint, test-unit, build]` |
| **Tag-based publish trigger** | Go modules are versioned via git tags, not registry uploads. Workflow must fire on `sdks/go/v*` tags and trigger proxy indexing | Medium | `on: push: tags: ['sdks/go/v*']`; run `GOPROXY=proxy.golang.org go list -m github.com/Divkix/Logwell/sdks/go@$VERSION` to warm the proxy cache |
| **`workflow_dispatch` trigger** | Manual re-runs without pushing a commit; already on both existing workflows | Low | Add to all three trigger types |
| **timeout-minutes on every job** | Prevents runaway jobs from burning CI minutes | Low | 10 minutes per job matches existing workflow pattern |
| **`defaults.run.working-directory`** | All `run` steps execute inside `sdks/go/` without repetitive `cd` | Low | Already used in both existing SDK workflows |
| **golangci-lint config file** | Linter is useless without a config that sets which linters run, their severity, and per-file exclusions | Low | `sdks/go/.golangci.yml`; sensible defaults: `govet`, `errcheck`, `staticcheck`, `unused`, `gosimple` |
| **go.mod minimum version bump to 1.22** | go.mod currently declares `go 1.21`, but the matrix tests 1.22+. Module should declare the minimum version it is actually tested against | Low | Single-line change to `sdks/go/go.mod` |

---

## Differentiators

Features that set this CI apart. Not expected, but add value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Race detector on test run** | Go's `-race` flag detects data races at runtime -- the `client_test.go` has explicit concurrency tests (`TestClientConcurrency`) that will surface races if present | Low | Add `-race` flag: `go test -race -v ./...`; only meaningful overhead on the concurrent tests |
| **Job summary output for publish step** | Match the quality of existing SDK workflows -- the Python and TypeScript workflows emit markdown summaries to `$GITHUB_STEP_SUMMARY` on publish/skip | Low | Copy the existing pattern: emit package name, version, install instructions |
| **Skip-if-already-published guard** | Go proxy does not error on re-requesting an existing version, but logging a clear "already indexed" message prevents confusion | Low | Check via `go list -m` with the proxy; if it returns without error, the version already exists -- skip and log |
| **`go mod tidy` verification** | Detects if `go.mod` / `go.sum` are out of sync with actual imports; catches forgotten `tidy` runs before they hit the proxy | Low | Add `go mod tidy && git diff --exit-code go.mod go.sum` to the lint job |
| **Caching Go module download cache** | Speeds up cold starts by caching `~/go/pkg/mod`; `actions/setup-go@v5` handles this automatically when `cache: true` | Low | Enable `cache: true` on `actions/setup-go` -- no extra step needed |

---

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Coverage reporting job** | No coverage tooling exists in the Go SDK yet; adding it now blocks the milestone and duplicates work done better later | Defer -- add as a separate milestone once baseline CI is green |
| **Integration test job** | The Go SDK has no `tests/integration/` directory, only unit tests in the `logwell/` package. The Python workflow has integration tests; Go doesn't. Forcing one now requires creating a test server and infra that is out of scope | Defer -- only add when an integration test suite exists |
| **Cross-compilation matrix** | This is a library SDK, not a binary. Cross-compiling produces no artifact users consume. The TypeScript and Python workflows don't do it either | Not applicable to SDK libraries |
| **GitHub Release creation** | Go module versioning is proxy-based, not GitHub Release-based. Creating releases with binaries is for CLI tools | Use the `sdks/go/vX.Y.Z` tag + proxy warm approach instead |
| **Changelog / release notes automation** | Separate concern; Python and TypeScript workflows also don't do this | Out of scope for this milestone |
| **Multiple OS matrix (Windows/macOS)** | This SDK is pure Go with no CGO or OS-specific syscalls. Testing on Linux is sufficient. Adding Windows/macOS triples CI time for no real risk surface | Run on `ubuntu-latest` only, matching existing SDK workflows |
| **golangci-lint exhaustive linter set** | Enabling every available linter (100+) causes noise, false positives, and slow CI | Pick a practical subset: `govet`, `errcheck`, `staticcheck`, `gosimple`, `unused` |

---

## Feature Dependencies

```
go.mod bump (1.21 -> 1.22)
  -> test-unit matrix (1.22, 1.23, 1.24)   # matrix floor must match declared minimum

golangci-lint config file (.golangci.yml)
  -> lint job                               # action will fail if verify=true finds no config

lint job
  -> (no dependency on test-unit)           # run in parallel, both gate publish

test-unit job
  -> (no dependency on lint)               # run in parallel

build job
  -> (no dependency on lint or test-unit)  # run in parallel

publish job
  -> needs: [lint, test-unit, build]       # all three must pass before publish runs

tag push (sdks/go/vX.Y.Z)
  -> publish job trigger                   # tag is both the version and the publish signal

GOPROXY warm request
  -> depends on tag existing in remote     # must run after tag is pushed/checked out
```

---

## MVP Recommendation

Prioritize in implementation order:

1. **go.mod bump to 1.22** -- Unblocks everything; one-line change with no risk
2. **golangci-lint config** (`sdks/go/.golangci.yml`) -- Required before lint job can run; define practical linter set
3. **`sdk-go.yml` workflow file** -- Core deliverable; implement jobs in order: lint, test-unit (with `-race`), build, publish
4. **go mod tidy check** in lint job -- Low complexity, high signal; catches drift before it reaches the proxy
5. **Job summary output** in publish job -- 10-line addition; makes the workflow match existing SDK quality bar

Defer:
- **Coverage job**: No infrastructure; adds milestone risk with no proportional value
- **Integration test job**: No tests exist to run

---

## Sources

- [golangci-lint-action GitHub repository](https://github.com/golangci/golangci-lint-action) -- confirmed v9 is latest (HIGH confidence)
- [Publishing a module -- go.dev](https://go.dev/doc/modules/publishing) -- authoritative proxy warm procedure (HIGH confidence)
- [GitHub Actions: Building and testing Go](https://docs.github.com/en/actions/use-cases-and-examples/building-and-testing/building-and-testing-go) -- setup-go@v5 confirmed current (HIGH confidence)
- [Go subdirectory module tag format](https://groups.google.com/g/golang-nuts/c/j3_al9mJt1o/m/HeVoIKz9AAAJ) -- `sdks/go/vX.Y.Z` tag format confirmed (HIGH confidence)
- Existing `sdk-python.yml` and `sdk-typescript.yml` in this repo -- job structure, action versions, concurrency pattern (HIGH confidence, primary source)
