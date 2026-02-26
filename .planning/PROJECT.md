# Logwell Go SDK CI Workflow

## What This Is

A GitHub Actions CI/CD workflow for the Logwell Go SDK (`sdks/go/`), matching the established patterns of the existing Python and TypeScript SDK workflows. It covers linting, testing across multiple Go versions, build verification, and tag-based publishing to the Go module proxy.

## Core Value

The Go SDK has the same quality gate and automated publish pipeline as the Python and TypeScript SDKs — no manual steps, consistent CI patterns across all SDKs.

## Requirements

### Validated

- ✓ Python SDK CI workflow exists — `sdk-python.yml` (lint, test, build, PyPI publish)
- ✓ TypeScript SDK CI workflow exists — `sdk-typescript.yml` (lint, test, build, npm/JSR publish)
- ✓ Go SDK source code exists at `sdks/go/` with tests and module definition
- ✓ Established CI pattern: path-filtered triggers, concurrency groups, job separation, artifact uploads

### Active

- [ ] Go SDK CI workflow file at `.github/workflows/sdk-go.yml`
- [ ] golangci-lint linting with sensible default config
- [ ] `go vet` static analysis
- [ ] Unit tests across Go 1.22, 1.23, 1.24
- [ ] Build verification (`go build ./...`)
- [ ] Tag-based publish step (trigger Go module proxy indexing on `sdks/go/vX.Y.Z` tags)
- [ ] Bump `go.mod` minimum version from 1.21 to 1.22
- [ ] golangci-lint config file at `sdks/go/.golangci.yml`

### Out of Scope

- Integration tests — Go SDK has no integration test directory, only unit tests
- Coverage reporting — can add later, not blocking v1 workflow
- Cross-compilation matrix — standard Go cross-compile not needed for a library SDK
- Releasing/changelog automation — separate concern from CI

## Context

- Go SDK module path: `github.com/Divkix/Logwell/sdks/go`
- Go SDK is a subdirectory module, so tags must follow `sdks/go/vX.Y.Z` format for proxy indexing
- Existing workflows use `actions/checkout@v6`, `actions/cache@v5`, `actions/upload-artifact@v6`
- Existing workflows use concurrency groups with `cancel-in-progress: true`
- All SDK workflows trigger on push to main + PRs to main, scoped to their directory
- Go module proxy (proxy.golang.org) indexes automatically when a valid semver tag exists — just need to request the module version URL to warm the cache

## Constraints

- **Pattern consistency**: Must follow the same job structure (lint → test → build → publish) as Python/TypeScript SDK workflows
- **Path filtering**: Only trigger on `sdks/go/**` and `.github/workflows/sdk-go.yml` changes
- **Go versions**: Test matrix of 1.22, 1.23, 1.24
- **golangci-lint**: Use `golangci/golangci-lint-action` GitHub Action (standard approach)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tag-based publish (not registry upload) | Go modules use git tags for versioning, no registry upload needed | — Pending |
| golangci-lint over just go vet | Industry standard, catches more issues, configurable | — Pending |
| Bump go.mod to 1.22 | Testing 1.22-1.24, module should declare minimum tested version | — Pending |
| Three Go versions in matrix | Balance between coverage and CI time (1.22, 1.23, 1.24) | — Pending |

---
*Last updated: 2026-02-26 after initialization*
