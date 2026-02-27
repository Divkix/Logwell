# Logwell Go SDK CI

## What This Is

A CI/CD pipeline for the Logwell Go SDK (`sdks/go/`). The SDK is a zero-dependency Go logging client with automatic batching, retry with exponential backoff, child loggers, and source location capture. The CI pipeline ensures code quality, test coverage, and release readiness on every push and PR.

## Core Value

Every change to the Go SDK is automatically tested, linted, and validated before merge — no broken SDK releases reach users.

## Requirements

### Validated

- ✓ GitHub Actions workflow for Go SDK CI — v1.0
- ✓ Run `go test` with race detector across Go versions — v1.0
- ✓ Run `go vet` and static analysis — v1.0
- ✓ Run `golangci-lint` for comprehensive linting — v1.0
- ✓ Test coverage reporting — v1.0
- ✓ Only trigger on changes to `sdks/go/` paths — v1.0
- ✓ Matrix testing across supported Go versions (1.25.x + stable) — v1.0

### Active

(None — v1.0 complete)

### Out of Scope

- SDK release automation (publishing to pkg.go.dev) — separate concern, future work
- Integration tests against a live Logwell instance — requires infrastructure
- Cross-platform testing (Windows/macOS) — Linux CI sufficient for pure Go library
- Coverage threshold enforcement — needs baseline measurement first

## Context

- CI workflow: `.github/workflows/sdk-go.yml` (4 jobs: lint, test-matrix, coverage, ci-success)
- Linter config: `sdks/go/.golangci.yml` (golangci-lint v2, 9 linters)
- Go minimum bumped to 1.25 (was 1.21)
- Shipped v1.0 with 2,827 LOC across 20 files

## Constraints

- **Path filtering**: CI triggers only on `sdks/go/**` and `.github/workflows/sdk-go.yml`
- **Go version**: Minimum Go 1.25 (per go.mod, bumped from 1.21)
- **No dependencies**: SDK uses only stdlib
- **Monorepo**: Workflow uses `defaults.run.working-directory: sdks/go`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GitHub Actions | Already used by the project, standard for Go CI | ✓ Good |
| golangci-lint v2 | Industry standard, v1 EOL | ✓ Good |
| Go 1.25.x + stable matrix | 1.24 EOL Feb 2026, test only supported releases | ✓ Good |
| GOTOOLCHAIN=local | Prevents auto-upgrade defeating matrix testing | ✓ Good |
| ci-success gate job | Stable branch protection for path-filtered workflows | ✓ Good |
| -covermode=atomic | Required with -race flag to avoid false positives | ✓ Good |

---
*Last updated: 2026-02-27 after v1.0 milestone*
