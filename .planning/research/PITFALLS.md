# Domain Pitfalls: Go SDK CI/CD in a Multi-SDK Monorepo

**Domain:** Go CI/CD workflow for a subdirectory Go module in a monorepo
**Researched:** 2026-02-26
**Scope:** Adding `.github/workflows/sdk-go.yml` for `sdks/go/` (module `github.com/Divkix/Logwell/sdks/go`)

---

## Critical Pitfalls

Mistakes that cause silent failures, wrong behavior, or require workflow rewrites.

---

### Pitfall 1: Wrong Tag Format Breaks Go Module Proxy Indexing

**What goes wrong:**
The Go module proxy (`proxy.golang.org`) requires version tags to be prefixed with the subdirectory path when the module lives in a subdirectory. For this repo, the correct tag is `sdks/go/v1.2.3` -- not `v1.2.3`. A bare `v1.2.3` tag will be interpreted as a release of the root module (which has no `go.mod`), and the proxy will either fail to index the Go SDK or index nothing at all.

**Why it happens:**
Developers familiar with single-module repos, or copying tag patterns from the Python/TypeScript SDKs (which don't have this constraint), use bare `vX.Y.Z` tags. The Go proxy silently ignores the tag or returns 404 for the module path.

**Consequences:**
- `go get github.com/Divkix/Logwell/sdks/go@v1.2.3` returns "module not found"
- `pkg.go.dev` documentation never appears
- Users on the module path get stale or no results from the proxy
- The publish step in CI "succeeds" (no error thrown) but the module is not actually indexed

**Prevention:**
- The workflow's `on.push.tags` filter must be `sdks/go/v*` not `v*`
- The publish step must request the GOPROXY URL to warm the cache using the correct `sdks/go/vX.Y.Z` version string
- Document the tag format in the workflow file comment header
- Verify with `go list -m github.com/Divkix/Logwell/sdks/go@vX.Y.Z` after tagging

**Detection (warning signs):**
- The publish step completes without error but `pkg.go.dev/github.com/Divkix/Logwell/sdks/go` still shows "Not Found"
- No `sdks/go/` prefix on tags in `git tag -l`

**Phase:** Publish step implementation

---

### Pitfall 2: `golangci-lint-action` Ignores Job-Level `defaults.run.working-directory`

**What goes wrong:**
Setting `defaults.run.working-directory: sdks/go` at the job level (which works perfectly for `go test`, `go build`, and other `run:` steps) does NOT propagate into `golangci/golangci-lint-action`. The action runs lint from the repository root, finds no `.golangci.yml` (because it is at `sdks/go/.golangci.yml`), loads the wrong module, and either errors or lints nothing meaningful.

**Why it happens:**
`golangci-lint-action` is a composite/JavaScript action that sets its own working context. It does not inherit the job's `defaults.run.working-directory`. This is a documented known issue in the action's GitHub Issues (issue #369).

**Consequences:**
- Lint runs on root `go` module (which does not exist here) instead of `sdks/go/`
- Error: `no Go files in /home/runner/work/...` or module-not-found from golangci-lint
- Silent: lint "passes" because there is nothing to lint at root

**Prevention:**
Always pass `working-directory` directly to the action's `with:` block:

```yaml
- uses: golangci/golangci-lint-action@v9
  with:
    working-directory: sdks/go
```

Do not rely on `defaults.run.working-directory` for this step specifically.

**Detection (warning signs):**
- golangci-lint job takes < 2 seconds (no packages found)
- Lint passes even when obvious errors are introduced
- Log shows `no Go files` or empty package list

**Phase:** Lint job implementation

---

### Pitfall 3: golangci-lint v1 Config Silently Fails Under v2

**What goes wrong:**
golangci-lint v2 (released 2025) introduced a mandatory `version: "2"` field in `.golangci.yml`. If this field is absent, the linter rejects the config with "invalid version of the configuration". More insidiously: copying a v1 config structure produces either silent ignoring of exclusions or hard failures.

**Key v1 to v2 field renames:**

| v1 field | v2 field |
|---|---|
| `linters-settings` | `linters.settings` |
| `issues.exclude-dirs` | `linters.exclusions.paths` |
| `issues.exclude-files` | `linters.exclusions.paths` |
| `issues.exclude-rules` | `linters.exclusions.rules` |
| `linters.disable-all` | `linters.default: none` |
| `run.skip-dirs` | `linters.exclusions.paths` |
| `output.format` | `output.formats` (new structure) |

**Also removed in v2:** `deadcode`, `golint`, `scopelint`, `varcheck`, `structcheck` linters -- enabling them causes a hard error, not a warning.

**Consequences:**
- CI fails on first run with cryptic config parse errors
- If you copied an internet example without checking its vintage, old linters cause hard failure
- Exclusion rules silently don't apply under v2 if using v1 field names

**Prevention:**
- Start the `.golangci.yml` with `version: "2"` as the first line
- Use `golangci-lint migrate` locally to convert any borrowed v1 config before committing
- Pin the action version (`golangci/golangci-lint-action@v9`) and golangci-lint version in the config

**Detection (warning signs):**
- First CI run fails with "invalid version of the configuration"
- Exclusion rules that work locally don't work in CI

**Phase:** golangci-lint config file creation

---

### Pitfall 4: Go Version Mismatch Between golangci-lint Binary and `go.mod`

**What goes wrong:**
When the `golangci-lint` binary in CI is built with Go 1.22 but `go.mod` declares `go 1.24`, golangci-lint emits:

```
the Go language version (go1.22) used to build golangci-lint is lower than the targeted Go version (1.24)
```

This is a hard failure. It happens when using `go install` to install golangci-lint (which compiles with whatever Go the runner has) rather than using pre-built binaries, or when the action version lags the `go.mod` minimum version.

**Consequences:**
- Lint job always fails, blocking all PRs
- Not obvious from error message that the action version is the cause

**Prevention:**
- Use `golangci/golangci-lint-action@v9` (which ships pre-built binaries) -- do not use `go install golangci-lint`
- After bumping `go.mod` minimum to 1.22 (planned), verify the action supports it
- Pin a recent golangci-lint version in the action's `with:` to ensure compatibility

**Detection (warning signs):**
- Lint always fails immediately after a `go.mod` version bump
- Error message mentions "used to build golangci-lint is lower than"

**Phase:** Lint job implementation and any future `go.mod` version bumps

---

### Pitfall 5: `setup-go` Cache Uses Root `go.sum` by Default -- Misses Subdirectory Module

**What goes wrong:**
`actions/setup-go` v4+ has built-in caching enabled by default. The cache key is based on `go.sum` found at the repository root. For this monorepo, `go.sum` lives at `sdks/go/go.sum`, not at the root. Without `cache-dependency-path`, the action either finds no `go.sum` (cache disabled silently) or uses a stale/wrong key that causes cache misses every run.

**Consequences:**
- Every CI run re-downloads all dependencies even when nothing changed
- Potentially caches nothing (no error, just slow)
- With matrix builds across 1.22/1.23/1.24, each Go version re-downloads everything

**Prevention:**
Always set `cache-dependency-path` to the subdirectory `go.sum`:

```yaml
- uses: actions/setup-go@v6
  with:
    go-version: ${{ matrix.go-version }}
    cache-dependency-path: sdks/go/go.sum
```

**Detection (warning signs):**
- Each run shows "Cache not found" in the setup-go step logs
- Dependency download step takes 30+ seconds on every run including re-runs of unchanged code

**Phase:** All jobs using `actions/setup-go`

---

## Moderate Pitfalls

---

### Pitfall 6: `go test ./...` Run From Wrong Directory

**What goes wrong:**
The existing pattern in this repo uses `defaults.run.working-directory` to scope all `run:` steps to the SDK subdirectory. If this is correctly applied to the Go workflow, `go test ./...` works. If it is accidentally omitted or set incorrectly, `go test ./...` runs from the repo root, finds no `go.mod` there, and either panics or tests nothing.

**Consequences:**
- Tests "pass" with zero packages tested (exit 0 but no actual test run)
- Or hard failure: `go: go.mod file not found in current directory or any parent directory`

**Prevention:**
- Set `defaults.run.working-directory: sdks/go` at the job level (consistent with Python/TypeScript patterns)
- Add a sanity step: `go list ./...` before `go test` to confirm packages are found

**Detection (warning signs):**
- Test job takes < 1 second
- No "=== RUN" or "--- PASS" lines in test output
- "no Go files" warnings

**Phase:** Test job implementation

---

### Pitfall 7: Stale `go.sum` -- Missing Entries Cause CI-Only Failures

**What goes wrong:**
If `go.sum` is committed without running `go mod tidy` after dependency changes, CI will fail with `missing go.sum entry for module providing package X`. This never fails locally if the developer has the module in their local cache.

**Consequences:**
- `go build ./...` or `go test ./...` fails in CI with cryptic missing checksum errors
- Developer cannot reproduce locally because their `GOMODCACHE` already has the entry

**Prevention:**
Add a `go mod tidy` verification step in CI:

```yaml
- name: Verify go.sum is tidy
  run: |
    go mod tidy
    git diff --exit-code go.sum
```

**Detection (warning signs):**
- CI fails with "missing go.sum entry" but local build passes
- `go.mod` was modified recently but `go.sum` commit timestamp does not match

**Phase:** Lint/build jobs

---

### Pitfall 8: Publish Step Triggers on Every Push to `main` Instead of Tag Only

**What goes wrong:**
Go module publishing (triggering proxy indexing) should only run when a `sdks/go/vX.Y.Z` tag is pushed. If the publish step is gated only on `github.ref == 'refs/heads/main'` (copying the Python/TypeScript publish pattern verbatim), it runs on every merge to main regardless of whether a version tag exists.

**Why it happens:**
Python and TypeScript SDKs publish on every push to main after checking if the version changed. Go modules work differently -- the version is a git tag, not a file field. Copying the `if: github.ref == 'refs/heads/main'` condition without adapting it creates wrong behavior.

**Consequences:**
- Publish step runs on every PR merge, always against non-tagged versions
- Proxy warming requests fail or warm `@latest` instead of a specific version

**Prevention:**
Gate the publish job on tag push:

```yaml
on:
  push:
    tags:
      - 'sdks/go/v*'
```

Or add a conditional to the publish job:

```yaml
if: startsWith(github.ref, 'refs/tags/sdks/go/v')
```

**Detection (warning signs):**
- Publish job runs on every PR merge to main
- No version number extractable from `$GITHUB_REF` (it is a branch ref, not a tag)

**Phase:** Publish job implementation

---

## Minor Pitfalls

---

### Pitfall 9: Matrix Test Strategy Missing `fail-fast: false`

**What goes wrong:**
Without `strategy.fail-fast: false`, if the Go 1.22 matrix leg fails, GitHub Actions cancels 1.23 and 1.24 immediately. You lose visibility into which versions are broken vs. which pass.

**Prevention:**

```yaml
strategy:
  fail-fast: false
  matrix:
    go-version: ['1.22', '1.23', '1.24']
```

---

### Pitfall 10: Concurrency Group Collision With Other SDK Workflows

**What goes wrong:**
If the concurrency group key is too generic (e.g., just `${{ github.ref }}`), the Go SDK workflow and Python SDK workflow running simultaneously on the same PR will cancel each other.

**Prevention:**
Use a workflow-specific prefix, matching the existing SDK pattern:

```yaml
concurrency:
  group: sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| `setup-go` step in all jobs | Missing `cache-dependency-path` for subdirectory `go.sum` | Always set `cache-dependency-path: sdks/go/go.sum` |
| golangci-lint job | Action ignores job-level `working-directory` default | Pass `working-directory: sdks/go` directly to action `with:` |
| golangci-lint config creation | v1 config copied from internet examples | Start from scratch with `version: "2"`, not from copied v1 snippets |
| golangci-lint config creation | Deprecated linters cause hard failure | Do not enable: `deadcode`, `golint`, `scopelint`, `varcheck` |
| Test matrix job | `defaults.run.working-directory` absent | Set it at job level, confirm with `go list ./...` |
| Publish job | Bare `v*` tags instead of `sdks/go/v*` | Filter tags as `sdks/go/v*`; extract version as `${GITHUB_REF#refs/tags/sdks/go/}` |
| Publish job | Copied "push to main" trigger from Python/TypeScript | Use tag trigger `on.push.tags: ['sdks/go/v*']`, not branch trigger |
| `go mod tidy` hygiene | Stale `go.sum` not caught pre-merge | Add `go mod tidy && git diff --exit-code` verification step |

---

## Sources

- [golangci-lint Migration Guide (v1 to v2)](https://golangci-lint.run/docs/product/migration-guide/) -- HIGH confidence (official docs)
- [golangci-lint-action GitHub repo](https://github.com/golangci/golangci-lint-action) -- HIGH confidence (official)
- [Issue #369: Respect default working-directory](https://github.com/golangci/golangci-lint-action/issues/369) -- HIGH confidence (official issue tracker)
- [Go Modules Reference: VCS version tags for subdirectories](https://go.dev/ref/mod#vcs-version) -- HIGH confidence (official Go docs)
- [Publishing Go Modules](https://go.dev/blog/publishing-go-modules) -- HIGH confidence (official Go blog)
- [actions/setup-go: cache-dependency-path](https://github.com/actions/setup-go) -- HIGH confidence (official)
