# Plan 02: GitHub Actions Workflow (sdk-go.yml)

```yaml
phase: 1
plan: 02
name: sdk-go-workflow
wave: 1
depends_on: [01]
files_modified:
  - .github/workflows/sdk-go.yml
requirements: [TRIG-01, TRIG-02, TRIG-03, TRIG-04, LINT-01, LINT-03, TEST-01, TEST-02, TEST-03, TEST-04, COV-01, COV-02, COV-03, INFR-01, INFR-02, INFR-03, INFR-04]
autonomous: true
estimated_minutes: 10
```

## Objective

Create `.github/workflows/sdk-go.yml` — the complete GitHub Actions workflow for the Go SDK. This single file delivers: path-filtered triggers with concurrency cancellation, golangci-lint v2 linting, Go test matrix with race detection across 1.25.x and 1.26.x, coverage reporting to job summary + artifact upload, and a `ci-success` gate job for branch protection.

## Context

- Follow sibling workflow structure exactly (`sdk-python.yml`, `sdk-typescript.yml`) for consistency
- `golangci-lint-action@v9` ignores `defaults.run.working-directory` — MUST use `with.working-directory` on the action step
- `-race` requires `-covermode=atomic` (not `count`)
- `GOTOOLCHAIN=local` prevents Go from auto-downloading newer toolchain, defeating matrix purpose
- `-count=1` bypasses Go test cache in CI
- Gate job must check for both `success` AND `skipped` results — path-filtered jobs are `skipped` when paths don't match
- `actions/setup-go@v6` with `cache-dependency-path: sdks/go/go.sum` for monorepo module caching
- Pin `golangci-lint` to `v2.10.1` (latest stable as of 2026-02-26)
- Coverage job runs on single Go version (1.26.x / stable) — no need for matrix on coverage

## must_haves

- [ ] Workflow triggers on push to main + PR for `sdks/go/**` and `.github/workflows/sdk-go.yml`
- [ ] Workflow includes `workflow_dispatch` trigger
- [ ] Concurrency group cancels in-progress runs
- [ ] Lint job uses `golangci-lint-action@v9` with `with.working-directory: sdks/go`
- [ ] Test job runs matrix `[1.25.x, 1.26.x]` with `-race -count=1 -v`
- [ ] `GOTOOLCHAIN: local` set as environment variable
- [ ] `fail-fast: false` in test matrix
- [ ] Coverage uses `-covermode=atomic -coverprofile=coverage.out`
- [ ] Coverage summary written to `$GITHUB_STEP_SUMMARY`
- [ ] Coverage artifact uploaded
- [ ] `ci-success` gate job with `if: always()` accepts `success` and `skipped`
- [ ] All jobs have `timeout-minutes: 10`
- [ ] `defaults.run.working-directory: sdks/go` set at workflow level

<task id="02.1">
### Task 1: Create sdk-go.yml workflow file

**Action:** Create `.github/workflows/sdk-go.yml` with the following complete content:

```yaml
name: SDK Go

on:
  push:
    branches: [main]
    paths:
      - "sdks/go/**"
      - ".github/workflows/sdk-go.yml"
  pull_request:
    branches: [main]
    paths:
      - "sdks/go/**"
      - ".github/workflows/sdk-go.yml"
  workflow_dispatch:

permissions:
  contents: read

# Cancel in-progress runs on same branch/PR
concurrency:
  group: sdk-go-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

defaults:
  run:
    working-directory: sdks/go

env:
  GOTOOLCHAIN: local

jobs:
  # =============================================================================
  # Lint
  # =============================================================================
  lint:
    name: Lint
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout code
        uses: actions/checkout@v6

      - name: Setup Go
        uses: actions/setup-go@v6
        with:
          go-version: stable
          cache-dependency-path: sdks/go/go.sum

      - name: Run golangci-lint
        uses: golangci/golangci-lint-action@v9
        with:
          version: v2.10.1
          working-directory: sdks/go

  # =============================================================================
  # Test Matrix
  # =============================================================================
  test:
    name: Test (Go ${{ matrix.go-version }})
    runs-on: ubuntu-latest
    timeout-minutes: 10
    strategy:
      fail-fast: false
      matrix:
        go-version: ["1.25.x", "1.26.x"]

    steps:
      - name: Checkout code
        uses: actions/checkout@v6

      - name: Setup Go ${{ matrix.go-version }}
        uses: actions/setup-go@v6
        with:
          go-version: ${{ matrix.go-version }}
          cache-dependency-path: sdks/go/go.sum

      - name: Run tests
        run: go test -race -count=1 -v ./...

  # =============================================================================
  # Coverage
  # =============================================================================
  coverage:
    name: Coverage
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout code
        uses: actions/checkout@v6

      - name: Setup Go
        uses: actions/setup-go@v6
        with:
          go-version: stable
          cache-dependency-path: sdks/go/go.sum

      - name: Run tests with coverage
        run: go test -race -count=1 -covermode=atomic -coverprofile=coverage.out ./...

      - name: Generate coverage summary
        run: |
          echo "## Coverage Report" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo '```' >> $GITHUB_STEP_SUMMARY
          go tool cover -func=coverage.out >> $GITHUB_STEP_SUMMARY
          echo '```' >> $GITHUB_STEP_SUMMARY

      - name: Upload coverage artifact
        uses: actions/upload-artifact@v6
        with:
          name: coverage-go
          path: sdks/go/coverage.out
          retention-days: 7

  # =============================================================================
  # Final Status Check (required for branch protection)
  # =============================================================================
  ci-success:
    name: CI Success
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: [lint, test, coverage]
    if: always()

    steps:
      - name: Check all jobs status
        run: |
          results=("${{ needs.lint.result }}" "${{ needs.test.result }}" "${{ needs.coverage.result }}")
          for result in "${results[@]}"; do
            if [[ "$result" != "success" && "$result" != "skipped" ]]; then
              echo "Job failed with result: $result"
              exit 1
            fi
          done
          echo "All jobs passed or were skipped"
        working-directory: .
```

**Critical details:**
1. `golangci-lint-action` has `working-directory: sdks/go` in `with:` block — NOT relying on `defaults.run`
2. `GOTOOLCHAIN: local` is set at workflow `env:` level — applies to all jobs
3. Test matrix uses `fail-fast: false` for independent failure reporting
4. Coverage uses `-covermode=atomic` (required with `-race`)
5. Coverage job runs on `stable` (latest Go) — only one coverage report needed
6. Gate job accepts both `success` and `skipped` — handles path-filtered non-Go PRs
7. Gate job overrides `working-directory` to `.` since it has no `run:` steps that need `sdks/go/`
8. `upload-artifact` uses `path: sdks/go/coverage.out` (full path from repo root, since action doesn't use working-directory defaults)

**Verify:**
```bash
# Check file exists
test -f .github/workflows/sdk-go.yml && echo "PASS: workflow exists" || echo "FAIL: workflow missing"

# Check triggers
grep -q "sdks/go/\*\*" .github/workflows/sdk-go.yml && echo "PASS: path filter" || echo "FAIL: path filter"

# Check golangci-lint working-directory in with block
grep -A2 "golangci-lint-action" .github/workflows/sdk-go.yml | grep -q "working-directory: sdks/go" && echo "PASS: lint working-dir" || echo "FAIL: lint working-dir"

# Check GOTOOLCHAIN
grep -q "GOTOOLCHAIN: local" .github/workflows/sdk-go.yml && echo "PASS: GOTOOLCHAIN" || echo "FAIL: GOTOOLCHAIN"

# Check fail-fast
grep -q "fail-fast: false" .github/workflows/sdk-go.yml && echo "PASS: fail-fast" || echo "FAIL: fail-fast"

# Check covermode atomic
grep -q "covermode=atomic" .github/workflows/sdk-go.yml && echo "PASS: covermode" || echo "FAIL: covermode"

# Check ci-success gate
grep -q "ci-success:" .github/workflows/sdk-go.yml && echo "PASS: gate job" || echo "FAIL: gate job"

# Check if: always()
grep -q "if: always()" .github/workflows/sdk-go.yml && echo "PASS: always condition" || echo "FAIL: always condition"
```
</task>

## Verification

```bash
# Full validation of all requirements
echo "=== Trigger Requirements ==="
grep -q 'paths:' .github/workflows/sdk-go.yml && echo "TRIG-01/02: PASS" || echo "TRIG-01/02: FAIL"
grep -q 'workflow_dispatch' .github/workflows/sdk-go.yml && echo "TRIG-03: PASS" || echo "TRIG-03: FAIL"
grep -q 'cancel-in-progress: true' .github/workflows/sdk-go.yml && echo "TRIG-04: PASS" || echo "TRIG-04: FAIL"

echo "=== Lint Requirements ==="
grep -q 'golangci-lint-action@v9' .github/workflows/sdk-go.yml && echo "LINT-01: PASS" || echo "LINT-01: FAIL"
# LINT-02 covered by Plan 01
grep -A2 'golangci-lint-action' .github/workflows/sdk-go.yml | grep -q 'working-directory: sdks/go' && echo "LINT-03: PASS" || echo "LINT-03: FAIL"
# LINT-04 covered by govet in golangci-lint config (Plan 01)

echo "=== Test Requirements ==="
grep -q '\-race -count=1 -v' .github/workflows/sdk-go.yml && echo "TEST-01: PASS" || echo "TEST-01: FAIL"
grep -q '1.25.x' .github/workflows/sdk-go.yml && grep -q '1.26.x' .github/workflows/sdk-go.yml && echo "TEST-02: PASS" || echo "TEST-02: FAIL"
grep -q 'GOTOOLCHAIN: local' .github/workflows/sdk-go.yml && echo "TEST-03: PASS" || echo "TEST-03: FAIL"
grep -q 'fail-fast: false' .github/workflows/sdk-go.yml && echo "TEST-04: PASS" || echo "TEST-04: FAIL"

echo "=== Coverage Requirements ==="
grep -q 'covermode=atomic' .github/workflows/sdk-go.yml && echo "COV-01: PASS" || echo "COV-01: FAIL"
grep -q 'GITHUB_STEP_SUMMARY' .github/workflows/sdk-go.yml && echo "COV-02: PASS" || echo "COV-02: FAIL"
grep -q 'upload-artifact' .github/workflows/sdk-go.yml && echo "COV-03: PASS" || echo "COV-03: FAIL"

echo "=== Infrastructure Requirements ==="
grep -q 'working-directory: sdks/go' .github/workflows/sdk-go.yml && echo "INFR-01: PASS" || echo "INFR-01: FAIL"
grep -q 'cache-dependency-path: sdks/go/go.sum' .github/workflows/sdk-go.yml && echo "INFR-02: PASS" || echo "INFR-02: FAIL"
grep -q 'ci-success:' .github/workflows/sdk-go.yml && grep -q 'if: always()' .github/workflows/sdk-go.yml && echo "INFR-03: PASS" || echo "INFR-03: FAIL"
grep -q 'timeout-minutes: 10' .github/workflows/sdk-go.yml && echo "INFR-04: PASS" || echo "INFR-04: FAIL"
```
