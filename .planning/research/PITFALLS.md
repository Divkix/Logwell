# Pitfalls Research

**Domain:** Go SDK CI pipeline (GitHub Actions, monorepo)
**Researched:** 2026-02-26
**Confidence:** HIGH (official GitHub docs + golangci-lint official docs + Go stdlib issue tracker + multiple corroborating sources)

---

## Critical Pitfalls

### Pitfall 1: Path-Filtered Workflows Block Required Status Checks

**What goes wrong:**
When a workflow uses `paths:` filtering and is marked as a required check in branch protection rules, pull requests that touch only non-Go files (e.g., the SvelteKit app, docs) will be permanently blocked at "Pending" because the Go SDK workflow never runs — and GitHub does not auto-pass a skipped workflow. The PR cannot merge.

**Why it happens:**
GitHub's required status checks model expects every named check to report a result. A workflow that is never triggered by path filtering reports nothing — not "skipped," not "passed" — just silence. Branch protection treats silence as failure.

This is a documented GitHub limitation with no native fix as of 2026. Official discussions (community/discussions#26251, #26857, #44490) confirm it remains unresolved.

**How to avoid:**
Two valid patterns:

1. **Aggregator job with `if: always()`** — Run a final `ci-success` job that depends on all conditional jobs and always runs (even when siblings are skipped). The aggregator job is the only thing marked as required. Pattern already used in the project's main `ci.yml`.

2. **Move path detection inside the workflow, not at trigger level** — Use `dorny/paths-filter` in a detection step, then gate subsequent jobs with `if: needs.detect.outputs.go == 'true'`. The workflow always triggers; it just exits early for irrelevant changes.

For this project, since Go SDK CI is a standalone workflow file (not the main `ci.yml`), option 1 is the cleaner path: add a `ci-success` job to the Go SDK workflow that always runs, and register only that job as the required check.

**Warning signs:**
- PR shows "Expected — Waiting for status to be reported" on the Go SDK check
- Merges to main are blocked even for unrelated file changes
- Team starts manually re-running skipped workflows to unblock PRs

**Phase to address:**
CI Workflow Setup phase — the initial workflow file must include the aggregator job before the workflow is registered as a required check.

---

### Pitfall 2: `golangci-lint` v1 Config with v2 Binary (or vice versa)

**What goes wrong:**
`golangci-lint` v2 (released 2025) is a breaking change from v1. Config files from v1 are incompatible with v2 and will silently produce wrong behavior or hard errors. The most common symptom is "invalid version of the configuration" or linters that were expected to run simply don't.

Specific breaking changes in v2:
- `enable-all` / `disable-all` replaced by `linters.default`
- `issues.exclude-generated` default changed from `lax` to `strict`
- `--out-format=github-actions` removed (was deprecated in v1.59, removed in v2)
- No default exclusions — all exclusions must be explicit

**Why it happens:**
The `golangci/golangci-lint-action` pins a version. If the `.golangci.yml` config was written for v1 and the action version bumps to v2 (or vice versa), the mismatch causes breakage. The error messages are not always obvious.

**How to avoid:**
- Pin both the action version and the binary version together: `uses: golangci/golangci-lint-action@v6` with `version: v2.x.x` explicitly set
- If starting fresh in 2026, write a v2 config from the start (no migration needed)
- Never rely on implicit "latest" for the lint binary — pin it in the action `with` block
- For a new project like this (zero existing config), write `.golangci.yml` with `version: "2"` at the top

**Warning signs:**
- CI runs golangci-lint but reports no issues even for obviously broken code
- "invalid version of the configuration" errors in CI output
- Linters that should trigger don't trigger
- Dependabot bumps the action version and CI immediately breaks

**Phase to address:**
CI Workflow Setup phase — write the `.golangci.yml` config file in v2 format from day one.

---

### Pitfall 3: `golangci-lint-action` Ignores Job-Level `working-directory`

**What goes wrong:**
When configuring the job with `defaults: run: working-directory: sdks/go`, the `golangci/golangci-lint-action` does NOT respect this setting. It runs from the repository root. Linting either fails (can't find go.mod) or runs on the wrong module.

Additionally, even when you correctly set the `working-directory` in the action's `with` block, annotations on PR diffs will show wrong file paths because paths are reported relative to the working directory, not the repository root — making PR annotations useless.

**Why it happens:**
The action uses its own internal logic to determine the working directory and does not inherit the job's `defaults.run.working-directory`. This is a known open issue (golangci-lint-action#369, golangci-lint-action#31).

The fix `args: --path-mode=abs` was added to resolve the annotation path issue, but it requires explicit configuration.

**How to avoid:**
```yaml
- uses: golangci/golangci-lint-action@v6
  with:
    working-directory: sdks/go
    args: --path-mode=abs --config=sdks/go/.golangci.yml
```

Both `working-directory` in the action `with` block AND `--path-mode=abs` in `args` are required. Place the `.golangci.yml` in `sdks/go/` (not the repository root) so golangci-lint finds it automatically when running from that directory, or point to it explicitly.

**Warning signs:**
- golangci-lint runs but reports no issues or errors about missing go.mod
- PR review annotations point to wrong files or don't appear at all
- `defaults: run: working-directory` is set at job level but lint still runs from root

**Phase to address:**
CI Workflow Setup phase.

---

### Pitfall 4: Race Detector Requires CGO — Will Silently Fail on CGO_ENABLED=0 Environments

**What goes wrong:**
The Go race detector (`go test -race`) depends on CGO and ThreadSanitizer. If `CGO_ENABLED=0` is set anywhere in the environment (common in Docker-based runners or when optimizing for static binaries), `go test -race` fails with a build error. This is not a flaky failure — it is a hard build failure that looks like a configuration error, not a test failure.

**Why it happens:**
Some CI setups set `CGO_ENABLED=0` globally in the environment to produce statically linked binaries for deployment. This leaks into test runs. GitHub-hosted `ubuntu-latest` runners do NOT set `CGO_ENABLED=0` by default, so this only bites when using custom runners or explicit env overrides.

For this project (`ubuntu-latest`, stdlib-only SDK), CGO is enabled by default — but an explicit `CGO_ENABLED=0` in the workflow env would break the race detector silently.

**How to avoid:**
- Do not set `CGO_ENABLED=0` in the workflow-level `env:` block
- If CGO_ENABLED must be 0 for a build step, scope it to that specific step, not the job or workflow
- The race detector command should always run as: `go test -race -covermode=atomic ./...` with no global CGO override

**Warning signs:**
- `go test -race` fails with "race detector requires cgo"
- CI fails on test step before any tests run
- Workflow env block contains `CGO_ENABLED: "0"`

**Phase to address:**
CI Workflow Setup phase.

---

### Pitfall 5: `-covermode=count` is Incompatible with `-race`; Must Use `-covermode=atomic`

**What goes wrong:**
Running `go test -race -cover` without `-covermode=atomic` produces data races in the coverage instrumentation itself. The cover tool inserts `GoCover.Count[N] = 1` assignments into goroutines, which are plain (non-atomic) writes to shared global variables. The race detector flags these as real data races, producing false positives that cause CI failures that are impossible to reproduce locally without `-race`.

**Why it happens:**
Default coverage mode is `count` (plain integer increments). The race detector sees concurrent goroutines writing to the same global without synchronization — because there isn't any in `count` mode.

Since Go 1.3, `go test -race -cover` automatically uses `-covermode=atomic`, but only when BOTH flags are passed together. If `-covermode=count` is explicitly set in the workflow, it overrides the automatic behavior and breaks again.

**How to avoid:**
Use `go test -race -covermode=atomic ./...` explicitly. Never set `-covermode=count` anywhere in CI when also using `-race`. The correct CI command is:
```
go test -race -covermode=atomic -coverprofile=coverage.out ./...
```

**Warning signs:**
- Race detector reports races in files like `logwell.test` or coverage instrumentation wrappers
- Tests pass locally (without -race) but fail in CI with race reports
- Race reports point to variables named `GoCover.*`

**Phase to address:**
CI Workflow Setup phase.

---

### Pitfall 6: Go Test Cache in CI Produces Stale Results from Cross-Job Caching

**What goes wrong:**
When using `actions/cache` to cache `~/.cache/go-build` across CI runs, a stale cache can cause `go test` to report cached `PASS` for tests that would now fail. This happens because Go's test cache key is based on package source content and test binary content — but NOT on external dependencies like environment variables that changed, server endpoints in integration-style tests (like `httptest`), or timing-sensitive behavior.

The opposite problem also exists: cache keys based on `go.sum` alone (not `go.mod`) in a stdlib-only project will never invalidate properly because `go.sum` never changes when there are no external dependencies.

**Why it happens:**
For a stdlib-only SDK like this one, `go.sum` is empty (no external deps). Keying the cache on `hashFiles('**/go.sum')` produces a constant cache key — every CI run hits the same cache, and stale test results are served indefinitely.

**How to avoid:**
Two approaches:

1. **Use `-count=1` to bypass test caching**: `go test -race -count=1 -covermode=atomic ./...`. The `-count=1` flag explicitly disables test result caching. This is the simplest and most reliable approach for CI.

2. **Key the build cache on `go.mod`** (not `go.sum`): For a stdlib-only project, key on `go.mod` content:
   ```yaml
   key: ${{ runner.os }}-go-${{ matrix.go-version }}-${{ hashFiles('sdks/go/go.mod') }}
   ```

For this project, use `-count=1` on all `go test` invocations in CI. Build cache is still useful for compilation speed; only test result caching should be bypassed.

**Warning signs:**
- CI shows `(cached)` in test output — tests aren't actually running
- go.sum is empty or unchanged, but cache hits occur every run
- A known-broken test shows `PASS` in CI

**Phase to address:**
CI Workflow Setup phase.

---

### Pitfall 7: `setup-go` Toolchain Auto-Upgrade Defeats Matrix Version Testing

**What goes wrong:**
Since Go 1.21, the `go` directive in `go.mod` is a hard minimum requirement, not a hint. If a `toolchain` directive is present in `go.mod` (or in any required module), Go will automatically download and use a newer toolchain than the one specified in the matrix. The matrix job claiming to test "Go 1.21" actually runs on Go 1.22 or later.

This means the version matrix doesn't test what it claims to test — compatibility bugs with the stated minimum version go undetected.

**Why it happens:**
Go's toolchain management (introduced with GOTOOLCHAIN env var in Go 1.21) respects `toolchain` directives and will upgrade itself. The `actions/setup-go` action installs the requested version, but then `go` itself may upgrade during the test run.

**How to avoid:**
Set `GOTOOLCHAIN=local` in the workflow environment to force Go to use exactly the installed toolchain version without auto-upgrading:
```yaml
env:
  GOTOOLCHAIN: local
```

For this project's `go.mod` (currently just `go 1.21`, no `toolchain` directive), this is not an active problem yet — but adding it now prevents a future footgun when dependencies or a `toolchain` line is added.

**Warning signs:**
- `go version` in CI output shows a version different from the matrix entry
- Adding a dependency that has a higher `go` directive causes matrix "1.21" job to upgrade
- Minimum version compatibility bugs slip through because the lower version is never actually tested

**Phase to address:**
CI Workflow Setup phase — set `GOTOOLCHAIN: local` from the start.

---

### Pitfall 8: `golangci-lint` Go Version Mismatch Causes Config Load Failure

**What goes wrong:**
golangci-lint is built for a specific Go version. If the Go version used to build golangci-lint is lower than the Go version targeted by the project (as specified in `go.mod`), golangci-lint refuses to load the configuration and exits with an error like: "the Go language version (go1.X) used to build golangci-lint is lower than the targeted Go version (1.Y)."

This error is easy to confuse with a configuration problem and wastes significant debugging time.

**Why it happens:**
The `golangci/golangci-lint-action` bundles a specific golangci-lint binary version. That binary was compiled with a specific Go version. If the binary is old and the project's `go.mod` targets a newer Go version, the mismatch triggers a hard failure.

**How to avoid:**
Always explicitly pin the golangci-lint version in the action, and update it when the project's Go version advances:
```yaml
- uses: golangci/golangci-lint-action@v6
  with:
    version: v2.x.x  # Must be built with Go >= project's go directive
```

Never rely on the `latest` tag — it may lag behind the Go toolchain version.

**Warning signs:**
- "the Go language version used to build golangci-lint is lower than the targeted Go version" error
- Lint CI fails immediately without running any linters
- Error appears only after bumping the `go` directive in `go.mod`

**Phase to address:**
CI Workflow Setup phase — pin explicitly; revisit when go.mod `go` directive changes.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Omit `timeout-minutes` on jobs | Less config | Jobs hang indefinitely on deadlock or network issue; burns runner hours | Never — always set timeouts |
| Use `go-version: 'stable'` instead of explicit version | Always latest | Matrix becomes meaningless; no historical record of what version was tested | Never in a versioned library |
| Skip `golangci-lint` entirely, rely on `go vet` | Faster setup | Misses entire classes of bugs (unused params, error wrapping, context misuse) | MVP only, replace in first sprint |
| Single Go version in matrix | Faster CI | No validation that 1.21 minimum is actually supported | Never for a public library |
| No `-count=1` flag on `go test` | Slight CI speedup | Stale cached PASS results mask real failures | Never in a correctness-critical library |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `golangci-lint-action` | Using job-level `defaults.run.working-directory` | Use `working-directory` in the action's `with:` block AND add `--path-mode=abs` to `args` |
| `actions/cache` for Go | Keying on `go.sum` when project has no external deps | Key on `go.mod` hash; use `-count=1` to prevent stale test results |
| `actions/setup-go` | Relying on matrix version without `GOTOOLCHAIN=local` | Always set `GOTOOLCHAIN: local` in workflow `env:` |
| Branch protection + path filters | Registering the filtered workflow as a required check | Register only the `ci-success` aggregator job; use `if: always()` |
| Race detector + coverage | Using `-covermode=count` with `-race` | Always use `-covermode=atomic` with `-race`; never set count mode explicitly |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Running `go test` without build cache across matrix | Each matrix job recompiles everything | Cache `~/.cache/go-build` per OS+Go-version | Immediately — 3x matrix means 3x compile time |
| No `concurrency: cancel-in-progress` | Stale PR runs waste runner capacity | Add concurrency group per PR number | When team pushes rapidly to PRs |
| Running lint in same job as tests | Either lint or tests must wait for the other | Separate lint and test into parallel jobs | When either lint or tests become slow (>2 min) |
| `golangci-lint` without `--timeout` | Lint hangs on large codebases | Set `--timeout=5m` in args | When linter analysis is expensive |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using `pull_request_target` instead of `pull_request` | Untrusted code runs with repository secrets | Use `pull_request` for external PRs; never `pull_request_target` without explicit trust checks |
| `permissions: write-all` or `contents: write` on CI jobs | Compromised workflow can push to main | Use minimum permissions: `contents: read` only |
| Logging API keys or secrets in test output | Secrets leak in CI logs | Tests use `validAPIKey()` helper (already done) — ensure helper generates fake keys, not real ones |

---

## "Looks Done But Isn't" Checklist

- [ ] **Path filter + required checks:** The Go SDK workflow is registered as a required check. Verify a PR that only changes `src/` (SvelteKit) can still merge — the `ci-success` aggregator must run and pass.
- [ ] **Race detector actually running:** `go test -race` output should include `WARNING: DATA RACE` for a known-bad test. Add a deliberate race to verify detection before trusting the CI step.
- [ ] **golangci-lint finding issues:** Add a deliberate unused variable or exported function without a doc comment — confirm CI catches it. Lint that never fails may not be running.
- [ ] **Matrix actually testing 1.21:** Check CI logs that `go version` in the 1.21 matrix job shows `go1.21.x` and NOT a higher version. If GOTOOLCHAIN is not set, it may auto-upgrade.
- [ ] **Coverage threshold enforced:** If a coverage floor is set, confirm that deleting a test file causes CI to fail on coverage — not just report a lower number.
- [ ] **Timeout set on all jobs:** A forgotten `defer ts.Close()` in test helpers (already present in this codebase's `transport_test.go`) can cause a test to hang. Verify `timeout-minutes` kills it within a predictable window.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Path filter blocks required checks | MEDIUM | Add `ci-success` aggregator job; update branch protection rule to require only that job; takes one PR cycle to validate |
| golangci-lint v1/v2 config mismatch | LOW | Run `golangci-lint migrate` to auto-convert; update action version pin; one commit fix |
| Stale test cache producing false PASS | LOW | Add `-count=1` to all `go test` commands; clear the Actions cache if a specific version is suspect |
| Race detector false positives in httptest | MEDIUM | Pin Go version to known-good release; add explicit `time.Sleep` drain or `goleak` check in test teardown; verify against Go issue tracker for known httptest races |
| Matrix not testing minimum Go version | LOW | Add `GOTOOLCHAIN: local` to workflow env; bump minimum to next version in matrix |
| golangci-lint Go version mismatch | LOW | Pin newer golangci-lint version compatible with project's Go directive; single workflow change |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Path filter blocks required checks | CI Workflow Setup | Test: open a PR changing only `src/routes/` — it must be mergeable without the Go SDK job running |
| golangci-lint v1/v2 mismatch | CI Workflow Setup | Confirm `.golangci.yml` has `version: "2"` at the top; action runs without config errors |
| golangci-lint ignores job working-directory | CI Workflow Setup | PR annotation must point to correct file path in `sdks/go/`; confirm with a deliberate lint error |
| Race detector fails with CGO disabled | CI Workflow Setup | No `CGO_ENABLED=0` in workflow env; `go test -race` step completes |
| `-covermode=count` + `-race` incompatibility | CI Workflow Setup | `go test -race -covermode=atomic` command is in workflow; no GoCover.* race reports |
| Test cache serves stale PASS | CI Workflow Setup | `-count=1` present in all `go test` invocations |
| `setup-go` toolchain auto-upgrade | CI Workflow Setup | `GOTOOLCHAIN: local` in workflow env; matrix 1.21 job shows `go1.21.x` in logs |
| golangci-lint Go version mismatch | CI Workflow Maintenance | Revisit golangci-lint pin whenever `go.mod` Go directive is bumped |

---

## Sources

- [GitHub Docs: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
- [GitHub Community: path filtering on required PR checks (Discussion #26857)](https://github.com/orgs/community/discussions/26857)
- [GitHub Community: path filter required status blocks (Discussion #26251)](https://github.com/orgs/community/discussions/26251)
- [golangci-lint v2 migration guide](https://golangci-lint.run/docs/product/migration-guide/)
- [golangci-lint-action: working-directory not respected (Issue #369)](https://github.com/golangci/golangci-lint-action/issues/369)
- [golangci-lint-action: setting workdir breaks annotations (Issue #31)](https://github.com/golangci/golangci-lint-action/issues/31)
- [golangci-lint: go version mismatch error (Issue #5641)](https://github.com/golangci/golangci-lint/issues/5641)
- [Go Data Race Detector — official docs](https://go.dev/doc/articles/race_detector)
- [httptest.Server race on Close (Issue #12262)](https://github.com/golang/go/issues/12262)
- [net/http/httptest: race in Close (Issue #51799)](https://github.com/golang/go/issues/51799)
- [Go test cache — working with it on CI (bjorn.now, 2025)](https://bjorn.now.sh/blog/2025/07/07/working-with-gos-test-cache-on-ci/)
- [actions/setup-go README](https://github.com/actions/setup-go)
- [brandur.org: Your Go version CI matrix might be wrong](https://brandur.org/fragments/go-version-matrix)
- [Go coverage + race: use -covermode=atomic](https://hermanschaaf.com/running-the-go-race-detector-with-cover/)
- [Welcome to golangci-lint v2](https://ldez.github.io/blog/2025/03/23/golangci-lint-v2/)
- [GitHub Actions concurrency cancel-in-progress (General Reasoning Corp, 2025)](https://generalreasoning.com/blog/2025/02/05/github-actions-concurrency.html)

---
*Pitfalls research for: Go SDK CI pipeline (GitHub Actions, monorepo)*
*Researched: 2026-02-26*
