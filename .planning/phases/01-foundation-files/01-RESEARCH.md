# Phase 1: Foundation Files - Research

**Researched:** 2026-02-26
**Domain:** Go module versioning + golangci-lint v2 configuration
**Confidence:** HIGH

## Summary

Phase 1 requires two file-level changes: bumping `go.mod` from `go 1.21` to `go 1.22`, and creating `sdks/go/.golangci.yml` with a valid golangci-lint v2 config. Both are straightforward mechanical edits with well-documented, stable APIs.

The critical complexity is the **golangci-lint v2 schema break**: v2 introduced the mandatory `version: "2"` header AND moved formatters (`gofmt`, `goimports`) out of the `linters.enable` list into a dedicated `formatters.enable` section. Any config that puts `gofmt` under `linters` will fail silently or emit deprecation warnings in v2. The five practical linters (govet, errcheck, staticcheck, ineffassign, unused) are the default "standard" set — no explicit enable needed if using `linters.default: standard`, but FOUND-02 requires them explicitly listed, so use `linters.default: none` + explicit enables.

The `go 1.22` directive is a language version (not a release version). Both `go 1.22` and `go 1.22.0` are syntactically valid, but `go 1.22` (without patch) is the canonical form for a minimum-version declaration and what all Go SDK library modules use. This is unambiguous per the Go modules reference.

**Primary recommendation:** Write the `.golangci.yml` with `version: "2"`, `linters.default: none`, explicit enable of the five linters, and `formatters.enable` containing gofmt and goimports. Change `go.mod` line from `go 1.21` to `go 1.22`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | go.mod minimum version bumped from 1.21 to 1.22 | Go modules reference confirms `go 1.22` (without patch) is valid canonical form; simple one-line edit |
| FOUND-02 | golangci-lint v2 config exists at `sdks/go/.golangci.yml` with `version: "2"` at top, practical linter set (govet, errcheck, staticcheck, ineffassign, unused), and gofmt/goimports formatters | golangci-lint v2 official docs confirm schema; formatters go in `formatters.enable` not `linters.enable`; five named linters are the standard default set |
</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| golangci-lint | v2.x (pinned in CI later) | Go linter aggregator | Industry standard; runs multiple linters in parallel with caching; config schema stable in v2 |
| Go modules | go 1.22 directive | Module minimum version declaration | Required by Go toolchain since 1.21+ became mandatory enforcement |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| govet | built-in | Detect suspicious constructs (shadowing, printf mismatches) | Always; catches real bugs |
| errcheck | built-in | Unchecked error returns | Always; Go's most common silent bug source |
| staticcheck | built-in | SA/ST/QF checks from staticcheck.io | Always; catches deprecated API use, unreachable code |
| ineffassign | built-in | Assignments that are immediately overwritten | Always; low noise, catches typos |
| unused | built-in | Unused constants/vars/funcs/types | Always; keeps code clean |
| gofmt | formatter | Standard Go formatting | Always; enforce canonical style |
| goimports | formatter | gofmt + organize imports | Always; catches missing/extra imports |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `linters.default: none` + explicit list | `linters.default: standard` (omit enable list) | Standard set is exactly the five linters but FOUND-02 requires them explicitly listed; use `none` + explicit for clarity and compliance |
| gofmt + goimports | gofumpt | gofumpt is stricter (enforces extra blank lines); unnecessary complexity for a library SDK |

## Architecture Patterns

### Recommended File Structure

```
sdks/go/
├── .golangci.yml    # NEW - golangci-lint v2 config
├── go.mod           # MODIFY - bump go 1.21 → go 1.22
├── go.sum           # unchanged
└── logwell/         # existing package code
```

### Pattern 1: golangci-lint v2 Minimal Practical Config

**What:** Explicit linter list with formatters in separate section. `default: none` ensures only the five named linters run, no surprises from future default-set changes.

**When to use:** All new configs targeting golangci-lint v2. Required because v2 config without `version: "2"` falls back to v1 parsing or errors.

**Example:**
```yaml
# Source: https://golangci-lint.run/docs/configuration/file/
version: "2"

linters:
  default: none
  enable:
    - govet
    - errcheck
    - staticcheck
    - ineffassign
    - unused

formatters:
  enable:
    - gofmt
    - goimports
```

### Pattern 2: go.mod Minimum Version Declaration

**What:** Single-line change to the `go` directive. Use the language version form (`1.22`), not the release form (`1.22.0`), for minimum declarations.

**When to use:** When bumping the Go minimum version constraint.

**Example:**
```
# Source: https://go.dev/ref/mod
module github.com/Divkix/Logwell/sdks/go

go 1.22
```

### Anti-Patterns to Avoid

- **Putting gofmt/goimports under `linters.enable`:** In v2, these are formatters. Placing them under `linters.enable` will emit deprecation warnings or silently ignore them depending on the v2 minor version. They belong under `formatters.enable`.
- **Omitting `version: "2"`:** Without this field, golangci-lint v2 will either reject the config or treat it as a v1 config. The field is mandatory for correct v2 behavior.
- **Using `linters.default: all`:** Enables 100+ linters including many that generate noise. Explicitly listed practical set is the correct approach per FOUND-02.
- **Using `go 1.22.0` in go.mod for minimum version:** Both are valid but `go 1.22` (language version without patch) is the canonical form for minimum version declarations in library modules. The patch form is used when go.mod was generated by a specific toolchain release.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Linting config | Custom shell scripts invoking individual linters | golangci-lint v2 config | Caching, parallel execution, unified output, CI integration |
| Import organization | Manual goimports invocation in Makefile | `formatters.enable: [goimports]` in .golangci.yml | Handled by golangci-lint format command |

**Key insight:** The `.golangci.yml` is a declarative config file, not code. The "implementation" IS writing the correct YAML structure. No logic needed.

## Common Pitfalls

### Pitfall 1: Formatters in Wrong Section

**What goes wrong:** Config has `gofmt` and `goimports` under `linters.enable`. golangci-lint v2 will warn or ignore them silently. The CI lint step will not enforce formatting.

**Why it happens:** v1 configs had formatters as regular linters. v2 split them into a separate `formatters` top-level section.

**How to avoid:** Always put `gofmt`, `goimports`, `gofumpt`, `gci` under `formatters.enable`, never under `linters.enable`.

**Warning signs:** Running `golangci-lint run` locally and seeing no formatting issues despite malformed code; or deprecation warnings mentioning "moved to formatters".

### Pitfall 2: Missing `version: "2"` Field

**What goes wrong:** Config file has valid YAML but no `version` field. golangci-lint behavior depends on the v2 subversion — some versions default to v1 parsing, some error.

**Why it happens:** Developers copy old configs or examples from v1-era blog posts.

**How to avoid:** `version: "2"` must be the first substantive line of `.golangci.yml`.

**Warning signs:** `golangci-lint run` exits with "unknown field" errors or parses the file but ignores v2-only options.

### Pitfall 3: `go 1.22` vs `go 1.22.0` in go.mod

**What goes wrong:** Using patch form (`go 1.22.0`) when the intent is minimum version. Both are valid Go syntax, but `go 1.21+` made the directive mandatory enforcement — the toolchain will refuse modules declaring a newer Go version than the running toolchain. The language version form `go 1.22` is safer as the minimum declaration.

**Why it happens:** Some `go mod tidy` runs with newer toolchains write the full patch version. For a library SDK declaring a minimum, the language version is correct.

**How to avoid:** Write `go 1.22` (no patch suffix) in go.mod.

**Warning signs:** Other Go SDK repos (stdlib, popular libraries) all use language version form for minimums.

### Pitfall 4: go.sum Out of Sync After go.mod Edit

**What goes wrong:** After bumping `go 1.21` to `go 1.22` in go.mod, `go mod tidy` may update go.sum. If not re-run, CI will fail the `go mod tidy && git diff --exit-code` check (required by LINT-04 in Phase 3).

**Why it happens:** go.mod version bump can change module graph resolution, adding or removing entries in go.sum.

**How to avoid:** After editing go.mod, run `go mod tidy` locally and commit both files together. (This SDK has no dependencies beyond stdlib currently, so go.sum is likely empty/minimal — low risk but worth noting.)

## Code Examples

Verified patterns from official sources:

### Complete `.golangci.yml` for FOUND-02

```yaml
# Source: https://golangci-lint.run/docs/configuration/file/
version: "2"

linters:
  default: none
  enable:
    - govet
    - errcheck
    - staticcheck
    - ineffassign
    - unused

formatters:
  enable:
    - gofmt
    - goimports
```

### go.mod After FOUND-01

```
# Source: https://go.dev/ref/mod
module github.com/Divkix/Logwell/sdks/go

go 1.22
```

### Verify Config Parses Without Errors (local validation)

```bash
# From sdks/go/ directory
golangci-lint run --config .golangci.yml ./...
# Exit 0 = config valid and no lint issues
# "level=error ... unknown field" = config schema wrong
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v1 config: `disable-all: true` + linters list | v2 config: `default: none` + `enable` list | golangci-lint v2 (2025) | v1 syntax deprecated; v2 required for golangci-lint-action@v9 |
| formatters as linters: `linters.enable: [gofmt]` | formatters in own section: `formatters.enable: [gofmt]` | golangci-lint v2 (2025) | Breaking change; old placement silently ignored or warned |
| `go` directive advisory | `go` directive mandatory enforcement | Go 1.21 (2023) | Toolchains refuse modules with newer declared Go version |

**Deprecated/outdated:**
- `linters.presets`: Removed in v2, replaced by `linters.default`. The migrate command converts this automatically.
- `linters-settings` top-level key: Moved into `linters.settings` nested under `linters` section in v2.
- `enable-all: true` / `disable-all: true`: Removed; use `linters.default: all` / `linters.default: none`.

## Open Questions

1. **Does the current Go SDK code pass the five linters as-is?**
   - What we know: The code exists (logwell/ package with client.go, transport.go, etc.); go.mod has no external dependencies.
   - What's unclear: Whether any existing code triggers errcheck, staticcheck, govet, or unused violations. Phase 1 only requires the config FILE to exist and parse without errors — not that the code is lint-clean.
   - Recommendation: FOUND-02 success criteria says "resolves the config without parse errors" — not zero lint issues. Creating the file satisfies Phase 1. Actual lint failures are caught in Phase 3 (LINT-01 through LINT-04).

## Sources

### Primary (HIGH confidence)
- `/golangci/golangci-lint` (Context7) - v2 config structure, formatters section, version field, linter list
- `/websites/golangci-lint_run` (Context7) - default linter set (errcheck, govet, ineffassign, staticcheck, unused confirmed as defaults)
- https://golangci-lint.run/docs/configuration/file/ - Full v2 config file structure, version field documentation
- https://golangci-lint.run/docs/product/migration-guide/ - Breaking changes: formatters moved, version field added, presets removed
- https://go.dev/ref/mod - Go directive syntax; both `go 1.22` and `go 1.22.0` valid; `go 1.22` is language version form

### Secondary (MEDIUM confidence)
- https://ldez.github.io/blog/2025/03/23/golangci-lint-v2/ - Author is golangci-lint maintainer (ldez); v2 overview confirmed against official docs
- https://golangci-lint.run/docs/welcome/quick-start - Default linter set confirmed: errcheck, govet, ineffassign, staticcheck, unused

### Tertiary (LOW confidence)
- None — all claims verified against official sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - golangci-lint v2 schema verified against official docs and Context7; Go directive syntax from go.dev/ref/mod
- Architecture: HIGH - Two files only, no structural ambiguity
- Pitfalls: HIGH - v1→v2 migration guide is explicit about formatters section change

**Research date:** 2026-02-26
**Valid until:** 2026-08-26 (golangci-lint config schema is stable once v2 released; Go directive semantics extremely stable)
