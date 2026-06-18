# Repository Guidelines

Self-hosted logging platform — SvelteKit + PostgreSQL + Bun.

## Critical Commands

| Task               | Command                       |
| ------------------ | ----------------------------- |
| Dev server         | `bun run dev` (port 5173)     |
| Production preview | `bun run preview` (port 3000) |
| Database start     | `bun run db:start`            |
| Migrations         | `bun run db:migrate`          |
| Schema push (dev)  | `bun run db:push`             |
| Seed admin         | `bun run db:seed`             |
| Lint + typecheck   | `vp check`                    |
| Run all tests      | `bun run test`                |
| Unit tests         | `bun run test:unit`           |
| Integration tests  | `bun run test:integration`    |
| E2E tests          | `bun run test:e2e`            |
| SDK tests          | `bun run sdk:test`            |
| Dead code check    | `bun run knip`                |

**Pre-commit checklist:** `vp check && bun run knip`

## Architecture

| Layer     | Tech                            |
| --------- | ------------------------------- |
| Framework | SvelteKit (Bun runtime)         |
| Database  | PostgreSQL 18                   |
| ORM       | Drizzle                         |
| Auth      | better-auth                     |
| UI        | shadcn-svelte + Tailwind CSS v4 |
| Real-time | Server-Sent Events              |
| Adapter   | `svelte-adapter-bun`            |

### Directory Structure

```
src/
  lib/
    components/ui/     # shadcn components
    server/db/         # Drizzle schema + queries
    server/jobs/       # Background jobs (log cleanup)
    server/utils/      # Server-only utilities
    shared/schemas/    # Zod schemas (shared)
    stores/            # Svelte stores
    hooks/             # Custom Svelte hooks
  routes/
    (app)/             # Authenticated routes
    api/               # API endpoints
    v1/                # Ingest endpoints (API key auth)
tests/
  integration/         # Integration tests (PGlite)
  e2e/                 # Playwright tests
  fixtures/            # Test fixtures
sdks/
  typescript/          # TypeScript SDK (separate package)
  python/              # Python SDK
  go/                  # Go SDK
```

## Database

- **Schema**: `src/lib/server/db/schema.ts`
- **Config**: `drizzle.config.ts` (requires `DATABASE_URL`)
- **Migrations**: Stored in `drizzle/` folder
- **Jobs**: Log cleanup via `src/lib/server/jobs/log-cleanup.ts`

### Environment Variables

Required in `.env`:

```env
DATABASE_URL="postgresql://root:mysecretpassword@localhost:5432/local"
BETTER_AUTH_SECRET="32-char-min-secret"
ADMIN_PASSWORD="8-char-min-password"
```

Generate secret: `openssl rand -base64 32`

## Testing Strategy

| Type        | Location                        | Runner         | DB                 |
| ----------- | ------------------------------- | -------------- | ------------------ |
| Unit        | Colocated (`*.unit.test.ts`)    | Vitest         | None (mocked)      |
| Component   | `src/lib/components/__tests__/` | Vitest (jsdom) | None               |
| Integration | `tests/integration/`            | Vitest         | PGlite (in-memory) |
| E2E         | `tests/e2e/`                    | Playwright     | Real PostgreSQL    |

**Integration tests** use `@electric-sql/pglite` (zero Docker overhead).
**E2E tests** require `docker compose up -d` for PostgreSQL.

### Test Configuration

- `vitest.config.ts` — Unit + integration projects
- `playwright.config.ts` — E2E (Chromium, Firefox)
- Integration tests auto-apply migrations via `tests/setup.ts`

## SDKs

Each SDK in `sdks/` is an independent package with its own tooling and publish workflows.

### TypeScript SDK (`sdks/typescript/`)

**Tech**: tsup (bundler), Vitest, vite-plus (lint/fmt), published to npm + JSR

```bash
# From repo root (uses package.json scripts)
bun run sdk:test        # Run all SDK tests
bun run sdk:build       # Build with tsup
bun run sdk:lint        # vp check

# From sdks/typescript/ directory
bun run build           # Build (CJS + ESM + types)
bun run test:unit       # Unit tests only
bun run test:integration # Integration tests (needs running Logwell server)
bun run check           # tsc --noEmit
bun run size            # Check bundle size (< 10KB limit)
bun run attw            # Validate types with @arethetypeswrong
```

**Entry**: `src/index.ts` | **Output**: `dist/` (CJS + ESM + .d.ts)
**Publish**: npm (`logwell`) + JSR (`@divkix/logwell`)

### Python SDK (`sdks/python/`)

**Tech**: hatchling (build), pytest, ruff (lint), mypy (types), httpx (HTTP client)

```bash
cd sdks/python

# Setup
uv venv                 # Create virtual env (or python -m venv .venv)
source .venv/bin/activate
uv pip install -e ".[dev]"  # Install with dev deps

# Development
pytest                  # Run all tests
pytest tests/unit/      # Unit tests only
pytest tests/integration/  # Integration tests (needs server)
ruff check .            # Lint
ruff check --fix .      # Lint + fix
mypy src/               # Type check
```

**Entry**: `src/logwell/__init__.py` | **Package**: `logwell` on PyPI

### Go SDK (`sdks/go/`)

**Tech**: Standard go modules, golangci-lint

```bash
cd sdks/go

go test ./...           # Run all tests
go test ./logwell/...   # Test main package
go vet ./...            # Static analysis
gofmt -l .              # Format check

# With golangci-lint (if installed)
golangci-lint run
```

**Entry**: `logwell/` | **Module**: `github.com/Divkix/Logwell/sdks/go`
**Zero external dependencies** — only standard library

## Linting & Formatting (vite-plus)

- Command: `vp check` (format + lint + typecheck), `vp check --fix` to auto-fix
- Config: `vite.config.ts` (`fmt`, `lint` sections)
- Uses oxlint + oxfmt under the hood
- Svelte files have relaxed rules (unused vars allowed)
- 2-space indent, single quotes, trailing commas

**Inline disable syntax:** `// oxlint-disable-next-line <rule>`

## CI/CD

GitHub Actions workflows:

- `ci.yml` — Lint, test (unit/integration/e2e), build, Docker
- `release.yml` — Multi-platform Docker images on tags
- `sdk-*.yml` — SDK releases

Docker images: `ghcr.io/divkix/logwell:latest`

## Common Gotchas

1. **Port confusion**: Dev = 5173, Production = 3000
2. **Bun required**: Always use `bun run`, never `npm`
3. **Adapter**: Uses `svelte-adapter-bun`, not Node adapter
4. **DB for E2E**: Must run `docker compose up -d` before `bun run test:e2e`
5. **Environment**: `bun run db:seed` needs `ADMIN_PASSWORD` set
6. **Migrations**: Use `db:migrate` (not `db:push`) in production

## Release Process

The **main app** and each **SDK** are versioned and released **independently** — each has its own version line (the app is not in lockstep with the SDKs). Commits and tags are GPG-signed (`commit.gpgsign` / `tag.gpgsign` are enabled), so signing must be available locally.

Two distinct trigger models, do not mix them up:

- **App** → **tag-triggered**: merging to `main` does NOT release; pushing a `v*` tag does.
- **SDKs (TS/Python)** → **merge-triggered**: pushing a version bump under `sdks/<lang>/**` to `main` runs the SDK workflow, which publishes whatever version is new. The `sdks/...@vX.Y.Z` tags are only git release **markers** — they do NOT trigger publishing. Publish jobs are idempotent: they check the registry and skip if the version already exists, so re-runs are safe.

### Main app — Docker image + GitHub Release (`release.yml`)

1. Bump `version` in the root `package.json` and merge to `main`. (The root `bun.lock` does not record the app version, so `--frozen-lockfile` is unaffected — no lockfile change needed.)
2. Tag the merge commit and push the tag:
   ```bash
   git tag -a v1.1.0 -m "Release v1.1.0"
   git push origin v1.1.0
   ```
   The `v*` tag triggers `release.yml` → multi-platform Docker images (`linux/amd64`, `linux/arm64`) to GHCR + a GitHub Release with auto-generated notes.

### TypeScript SDK — npm + JSR (`sdk-typescript.yml`, on push to `main` under `sdks/typescript/**`)

1. **Bump BOTH version fields** — they are separate and easy to desync:
   - `sdks/typescript/package.json` → `version` (read by the **npm** publish)
   - `sdks/typescript/jsr.json` → `version` (read by the **JSR** publish)

   If you bump only `package.json`, npm gets the new version while JSR silently stays on the old one (the JSR step finds the old version already published and skips).

2. Merge to `main`. The workflow publishes to npm (OIDC) if `package.json`'s version is new, and to JSR (`npx jsr publish`, OIDC) if `jsr.json`'s version is new.
3. (Optional) push the marker tag:
   ```bash
   git tag -a "sdks/typescript@v1.1.0" -m "Release sdks/typescript v1.1.0"
   git push origin "sdks/typescript@v1.1.0"
   ```

### Python SDK — PyPI (`sdk-python.yml`, on push to `main` under `sdks/python/**`)

1. Bump `version` in `sdks/python/pyproject.toml`, then sync the lockfile (it records the project version, and CI runs `uv lock --check`):
   ```bash
   cd sdks/python && uv lock
   ```
2. Merge to `main` → publishes to PyPI (OIDC) if the version is new.
3. (Optional) marker tag:
   ```bash
   git tag -a "sdks/python@v1.1.0" -m "Release sdks/python v1.1.0"
   git push origin "sdks/python@v1.1.0"
   ```

### Go SDK — tag-resolved by `go get` (no publish workflow)

Use the **slash** tag format so the Go toolchain can resolve the subdirectory module via `go get github.com/Divkix/Logwell/sdks/go@vX.Y.Z`:

```bash
git tag -a "sdks/go/v1.1.0" -m "Release sdks/go v1.1.0"
git push origin "sdks/go/v1.1.0"
```

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
