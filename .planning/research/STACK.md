# Technology Stack: Go SDK CI/CD Workflow

**Project:** Logwell Go SDK CI Workflow
**Researched:** 2026-02-26
**Scope:** GitHub Actions CI/CD stack for Go SDK in an existing multi-SDK monorepo

---

## Recommended Stack

### GitHub Actions (Core)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `actions/checkout` | `v6` | Repo checkout | Matches existing Python/TS workflows exactly -- don't diverge |
| `actions/setup-go` | `v6` | Go toolchain install + module cache | v6 is latest stable; built-in `cache: true` eliminates need for separate `actions/cache` step |
| `golangci/golangci-lint-action` | `v9` | Lint runner | Official action from golangci authors; v9 upgraded to node24 runtime, v8+ requires golangci-lint v2 |
| `actions/upload-artifact` | `v6` | Build artifact storage | Matches existing workflows |
| `andrewslotin/go-proxy-pull-action` | `v1.4.0` | Warm Go module proxy on tag publish | Correct way to trigger proxy.golang.org + pkg.go.dev indexing for subdirectory modules |

**Confidence:** HIGH -- versions verified against GitHub releases pages (Feb 2026).

### Linting

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `golangci-lint` | `v2.10.1` | Multi-linter runner | Latest stable as of Feb 17, 2026; v2 is a breaking change from v1 -- new config format required |
| `.golangci.yml` config | `version: "2"` | Linter configuration | Must include `version: "2"` at top-level or lint action defaults to v1 parsing |

**Confidence:** HIGH -- verified against golangci-lint releases page.

### Go Toolchain

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Go | `1.22`, `1.23`, `1.24` (matrix) | Test matrix | Matches PROJECT.md requirement; 1.22 is the new minimum per the go.mod bump decision |
| go.mod minimum | `go 1.22` | Module compatibility declaration | Current go.mod declares 1.21 but matrix starts at 1.22 -- bump to match actual minimum tested |

**Confidence:** HIGH -- Go 1.24 is current stable, 1.22+ is well-supported.

---

## Specific Action Configurations

### actions/setup-go@v6 -- Use Built-in Caching

```yaml
- uses: actions/setup-go@v6
  with:
    go-version: ${{ matrix.go-version }}
    cache: true
    cache-dependency-path: sdks/go/go.sum
```

`cache: true` (default in v4+) caches both `GOCACHE` and `GOMODCACHE` using `go.sum` as the key. No separate `actions/cache` step needed. The `cache-dependency-path` is required because this is a subdirectory module -- without it, setup-go looks for `go.sum` at the repo root and misses.

**Confidence:** HIGH -- documented in actions/setup-go README, v6.3.0 changelog.

### golangci/golangci-lint-action@v9 -- Requires setup-go First

```yaml
- uses: actions/setup-go@v6
  with:
    go-version: stable
    cache: false        # lint job does not need module cache
- uses: golangci/golangci-lint-action@v9
  with:
    version: v2.10.1
    working-directory: sdks/go
    args: --timeout=5m
```

`actions/setup-go` MUST come before `golangci-lint-action` -- hard requirement since v4 of the lint action. The `working-directory` input is needed for the monorepo subdirectory layout.

**Confidence:** HIGH -- explicitly documented in golangci-lint-action README.

### andrewslotin/go-proxy-pull-action@v1.4.0 -- Proxy Warming on Tag

```yaml
on:
  push:
    tags:
      - 'sdks/go/v[0-9]+.[0-9]+.[0-9]+'

jobs:
  publish:
    steps:
      - uses: andrewslotin/go-proxy-pull-action@v1.4.0
        with:
          import_path: github.com/Divkix/Logwell/sdks/go
```

This hits `proxy.golang.org/github.com/Divkix/Logwell/sdks/go/@v/<tag>.info` which triggers the proxy to fetch and cache the version. pkg.go.dev monitors the index and picks it up within minutes. No `GONOSUMCHECK` or special env needed for public modules.

Alternative (no action dependency): A raw `curl https://proxy.golang.org/github.com/Divkix/Logwell/sdks/go/@v/v1.0.0.info` achieves the same result but requires shell string manipulation to extract the version from the tag ref.

**Confidence:** HIGH for proxy warming mechanism; MEDIUM for action version (v1.4.0, Feb 2 2026 release confirmed).

---

## golangci-lint v2 Configuration

The `.golangci.yml` at `sdks/go/.golangci.yml` must use the v2 format:

```yaml
version: "2"

run:
  timeout: 5m
  tests: true

linters:
  default: standard    # enables the golangci-lint v2 default set
  enable:
    - errcheck
    - govet
    - staticcheck
    - ineffassign
    - unused

formatters:
  enable:
    - gofmt
    - goimports

issues:
  max-issues-per-linter: 0
  max-same-issues: 0
```

**Key change from v1:** The `version: "2"` field is mandatory. The `linters.default: standard` replaces the old `linters.enable-all: false` pattern. The `formatters` section is new in v2 -- formatters (gofmt, goimports) are now separate from issue-finding linters.

**Confidence:** HIGH for config format; MEDIUM for exact linter selection (standard set is correct baseline for an SDK library, project may want to tighten).

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Lint action | `golangci/golangci-lint-action@v9` | `reviewdog/action-golangci-lint` | reviewdog adds annotation overhead; official action has smarter caching and is maintained by golangci authors |
| Proxy warming | `andrewslotin/go-proxy-pull-action@v1.4.0` | Inline `curl` step | curl requires tag extraction shell gymnastics; action handles subdirectory tag patterns natively |
| Proxy warming | `andrewslotin/go-proxy-pull-action@v1.4.0` | Skip proxy warming | Without warming, pkg.go.dev may take hours to show docs; not a blocker but bad UX for SDK users |
| Cache strategy | `setup-go cache: true` | `actions/cache@v4` manually | setup-go built-in cache is correct and simpler; manual cache was needed pre-v4 |
| golangci-lint version | `v2.10.1` (pinned) | `latest` keyword | `latest` in CI is non-deterministic; pin to avoid surprise breaks from major version bumps |
| Go test runner | `go test ./...` | `gotestsum` | gotestsum is nicer output but adds a dependency; project does not need it yet |

---

## What NOT to Use

- **`golangci-lint-action@v6` or below**: These use the v1 config format. The `version: "2"` config in `.golangci.yml` will be misinterpreted. Use v8+ (which requires golangci-lint v2.1.0+) or v9.
- **`actions/cache@v5` manually for Go modules**: setup-go@v4+ handles this natively. Adding a manual cache step creates conflicts and doubles cache writes.
- **`go vet` as a separate step**: golangci-lint v2 with `default: standard` already runs govet. Running it twice wastes time and creates confusing duplicate output.
- **Cross-platform matrix (ubuntu + windows + macos)**: This is a client library SDK. Platform-specific behavior is irrelevant. `ubuntu-latest` only.
- **`goreleaser`**: Overkill for a Go module library. Go modules do not need binary releases. Tags + proxy warming is sufficient.
- **`GONOSUMCHECK` or `GONOSUMDB`**: Not needed for public modules on GitHub. Only relevant for private modules.

---

## Workflow Job Structure (Recommended)

Matching the `lint -> test -> build -> publish` pattern of the existing Python and TypeScript workflows:

```
lint          (golangci-lint, no matrix, ubuntu-latest)
test          (go test ./... -race, matrix: 1.22 / 1.23 / 1.24)
build         (go build ./..., single version, ubuntu-latest)
publish       (proxy warming, tag-triggered only, needs: [lint, test, build])
```

The `publish` job triggers on `sdks/go/vX.Y.Z` tag push -- not on every main push. This intentionally diverges from the Python/TS publish trigger (which is version-file-based) because Go module publishing is tag-based by design. There is no registry to upload to; the tag itself is the release artifact.

The `concurrency` group should be `sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}` to match the existing pattern.

---

## Sources

- [golangci-lint-action releases (latest: v9.2.0)](https://github.com/golangci/golangci-lint-action/releases)
- [golangci-lint releases (latest: v2.10.1, Feb 17 2026)](https://github.com/golangci/golangci-lint/releases)
- [actions/setup-go releases (latest: v6.3.0)](https://github.com/actions/setup-go/releases)
- [golangci-lint v2 configuration docs](https://golangci-lint.run/docs/configuration/file/)
- [golangci-lint CI installation docs](https://golangci-lint.run/docs/welcome/install/ci/)
- [go-proxy-pull-action (v1.4.0, Feb 2 2026)](https://github.com/andrewslotin/go-proxy-pull-action)
- [pkg.go.dev about -- triggering module indexing](https://pkg.go.dev/about)
- [Go module proxy protocol](https://go.dev/ref/mod#module-proxy)
