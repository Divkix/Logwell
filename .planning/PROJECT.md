# Logwell Go SDK CI

## What This Is

A CI/CD pipeline for the Logwell Go SDK (`sdks/go/`). The SDK is a zero-dependency Go logging client with automatic batching, retry with exponential backoff, child loggers, and source location capture. The CI pipeline ensures code quality, test coverage, and release readiness on every push and PR.

## Core Value

Every change to the Go SDK is automatically tested, linted, and validated before merge — no broken SDK releases reach users.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] GitHub Actions workflow for Go SDK CI
- [ ] Run `go test` with race detector across Go versions
- [ ] Run `go vet` and static analysis
- [ ] Run `golangci-lint` for comprehensive linting
- [ ] Test coverage reporting
- [ ] Only trigger on changes to `sdks/go/` paths
- [ ] Matrix testing across multiple Go versions (1.21+)

### Out of Scope

- SDK release automation (publishing to pkg.go.dev) — separate concern, future work
- Integration tests against a live Logwell instance — requires infrastructure
- Cross-platform testing (Windows/macOS) — Linux CI sufficient for pure Go library

## Context

- The Go SDK lives at `sdks/go/` in a monorepo (Logwell is primarily a SvelteKit app)
- The SDK has zero external dependencies (stdlib only)
- Existing test files: `client_test.go`, `config_test.go`, `queue_test.go`, `transport_test.go` with `client_test_helpers.go`
- Go module: `github.com/Divkix/Logwell/sdks/go` requiring Go 1.21+
- No existing CI workflow for the Go SDK

## Constraints

- **Path filtering**: CI must only trigger on `sdks/go/**` changes to avoid unnecessary runs
- **Go version**: Minimum Go 1.21 (per go.mod)
- **No dependencies**: SDK uses only stdlib, so no dependency caching complexity beyond Go modules
- **Monorepo**: Workflow must work within the monorepo structure, running from `sdks/go/` working directory

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GitHub Actions | Already used by the project, standard for Go CI | — Pending |
| golangci-lint | Industry standard Go linter aggregator | — Pending |
| Matrix Go versions | Ensure compatibility with stated 1.21+ requirement | — Pending |

---
*Last updated: 2026-02-26 after initialization*
