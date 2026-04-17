# Logwell — Agent Instructions

Self-hosted logging platform (SvelteKit + PostgreSQL + Bun).

## Critical Commands

| Task | Command |
|------|---------|
| Dev server | `bun run dev` (port 5173) |
| Production preview | `bun run preview` (port 3000) |
| Database start | `bun run db:start` |
| Migrations | `bun run db:migrate` |
| Schema push (dev) | `bun run db:push` |
| Seed admin | `bun run db:seed` |
| Lint + typecheck | `bun run lint && bun run check` |
| Run all tests | `bun run test` |
| Unit tests | `bun run test:unit` |
| Integration tests | `bun run test:integration` |
| E2E tests | `bun run test:e2e` |
| SDK tests | `bun run sdk:test` |
| Dead code check | `bun run knip` |

**Pre-commit checklist:** `bun run lint && bun run check && bun run knip`

## Architecture

| Layer | Tech |
|-------|------|
| Framework | SvelteKit (Bun runtime) |
| Database | PostgreSQL 18 |
| ORM | Drizzle |
| Auth | better-auth |
| UI | shadcn-svelte + Tailwind CSS v4 |
| Real-time | Server-Sent Events |
| Adapter | `svelte-adapter-bun` |

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

| Type | Location | Runner | DB |
|------|----------|--------|-----|
| Unit | Colocated (`*.unit.test.ts`) | Vitest | None (mocked) |
| Component | `src/lib/components/__tests__/` | Vitest (jsdom) | None |
| Integration | `tests/integration/` | Vitest | PGlite (in-memory) |
| E2E | `tests/e2e/` | Playwright | Real PostgreSQL |

**Integration tests** use `@electric-sql/pglite` (zero Docker overhead).
**E2E tests** require `docker compose up -d` for PostgreSQL.

### Test Configuration

- `vitest.config.ts` — Unit + integration projects
- `playwright.config.ts` — E2E (Chromium, Firefox)
- Integration tests auto-apply migrations via `tests/setup.ts`

## SDKs

Each SDK in `sdks/` is an independent package with its own tooling and publish workflows.

### TypeScript SDK (`sdks/typescript/`)

**Tech**: tsup (bundler), Vitest, Biome, published to npm + JSR

```bash
# From repo root (uses package.json scripts)
bun run sdk:test        # Run all SDK tests
bun run sdk:build       # Build with tsup
bun run sdk:lint        # Biome check

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

## Linting & Formatting (Biome)

- Config: `biome.json`
- Svelte files have relaxed rules (unused vars allowed)
- 2-space indent, single quotes, trailing commas
- Import organization enabled

**Key overrides for `.svelte` files:**
- `noUnusedImports` / `noUnusedVariables` = off
- `useConst` / `useImportType` = off

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

```bash
# Tag format: v* (e.g., v1.0.7)
git tag -a v1.0.7 -m "Release v1.0.7"
git push origin v1.0.7
```

Release workflow builds multi-platform Docker images (`linux/amd64`, `linux/arm64`).
