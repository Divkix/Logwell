# Plan 01: golangci-lint Config and Go Module Update

```yaml
phase: 1
plan: 01
name: golangci-lint-config-and-gomod
wave: 1
depends_on: []
files_modified:
  - sdks/go/.golangci.yml
  - sdks/go/go.mod
requirements: [LINT-02, LINT-04]
autonomous: true
estimated_minutes: 5
```

## Objective

Create the golangci-lint v2 configuration file at `sdks/go/.golangci.yml` and bump `go.mod` minimum from Go 1.21 to 1.25 to align with the tested matrix versions.

## Context

- golangci-lint v2 requires `version: "2"` as the top-level key — the v2 binary cannot parse v1 config format
- The linter set is Claude's discretion per CONTEXT.md — use a pragmatic standard set appropriate for a library SDK
- `govet` is included by default in golangci-lint v2, satisfying LINT-04 without a separate step
- Formatters section is new in v2 — separate from linters section
- `go.mod` currently declares `go 1.21` but we test only 1.25.x and 1.26.x; the declared minimum should match

## must_haves

- [ ] `.golangci.yml` exists at `sdks/go/` with `version: "2"` as first key
- [ ] Linter set includes at minimum: errcheck, govet, staticcheck, unused, gosimple, ineffassign
- [ ] `go.mod` declares `go 1.25` (not 1.21)

<task id="01.1">
### Task 1: Create golangci-lint v2 config

**Action:** Create `sdks/go/.golangci.yml` with the following content:

```yaml
version: "2"

linters:
  default: none
  enable:
    - errcheck
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gosimple
    - gocritic
    - revive
    - misspell

formatters:
  enable:
    - gofmt

issues:
  max-issues-per-linter: 0
  max-same-issues: 0
```

**Rationale:**
- `default: none` + explicit `enable` list avoids surprise when golangci-lint adds new default linters
- `errcheck`, `govet`, `staticcheck`, `unused`, `gosimple`, `ineffassign` are the Go community standard set
- `gocritic` adds common style improvements, `revive` is the maintained successor to `golint`, `misspell` catches typos
- `gofmt` in formatters section (v2 moved formatters out of linters section)
- `max-issues-per-linter: 0` and `max-same-issues: 0` ensure all issues are reported, not truncated

**Verify:**
```bash
cd sdks/go && cat .golangci.yml | head -1
# Expected: version: "2"
```
</task>

<task id="01.2">
### Task 2: Bump go.mod minimum to 1.25

**Action:** Update `sdks/go/go.mod` to change the `go` directive from `1.21` to `1.25`.

Current content:
```
module github.com/Divkix/Logwell/sdks/go

go 1.21
```

Updated content:
```
module github.com/Divkix/Logwell/sdks/go

go 1.25
```

Then run `go mod tidy` from `sdks/go/` to ensure consistency and generate/update `go.sum` if needed.

**Rationale:**
- Testing only Go 1.25.x and 1.26.x; declaring 1.21 misleads users into thinking older versions work
- `go mod tidy` ensures module files are consistent after the version bump

**Verify:**
```bash
cd sdks/go && grep "^go " go.mod
# Expected: go 1.25
```
</task>

## Verification

```bash
# Check config exists and has v2 format
test -f sdks/go/.golangci.yml && head -1 sdks/go/.golangci.yml | grep -q 'version: "2"' && echo "PASS: v2 config" || echo "FAIL: v2 config"

# Check go.mod version
grep -q "^go 1.25" sdks/go/go.mod && echo "PASS: go.mod bumped" || echo "FAIL: go.mod not bumped"

# Check govet is covered (satisfies LINT-04)
grep -q "govet" sdks/go/.golangci.yml && echo "PASS: govet enabled" || echo "FAIL: govet missing"
```
