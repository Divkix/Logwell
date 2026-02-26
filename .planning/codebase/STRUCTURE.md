# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
montpellier/
├── src/                        # Application source code
│   ├── lib/                    # Reusable libraries and utilities
│   │   ├── server/             # Server-only code (not shipped to browser)
│   │   │   ├── db/             # Database layer (Drizzle ORM)
│   │   │   ├── utils/          # Server utilities (auth, API key, parsing)
│   │   │   ├── config/         # Environment and config validation
│   │   │   ├── jobs/           # Background jobs (log cleanup)
│   │   │   └── [*.ts]          # Auth, events, error handling
│   │   ├── components/         # UI components (shadcn-svelte + custom)
│   │   │   └── ui/             # Primitive components from shadcn
│   │   ├── shared/             # Shared types and constants (client + server)
│   │   ├── stores/             # Svelte reactive stores
│   │   ├── types/              # Shared type definitions
│   │   ├── utils/              # Client utilities
│   │   ├── hooks/              # Svelte hooks
│   │   ├── assets/             # Static assets
│   │   └── [*.ts]              # Utility functions, types, constants
│   ├── routes/                 # SvelteKit file-based routing
│   │   ├── (app)/              # Protected routes (require auth)
│   │   │   ├── projects/       # Project management UI
│   │   │   │   ├── [id]/       # Single project view
│   │   │   │   │   ├── logs/   # Log viewer page
│   │   │   │   │   ├── incidents/ # Incident dashboard
│   │   │   │   │   ├── settings/ # Project settings
│   │   │   │   │   └── stats/  # Statistics page
│   │   │   └── +layout.*       # App-level layout (auth required)
│   │   ├── api/                # REST API endpoints
│   │   │   ├── health/         # Health check
│   │   │   ├── projects/       # Project CRUD and streaming
│   │   │   │   ├── [id]/       # Project-specific endpoints
│   │   │   │   │   ├── logs/   # Log query and export
│   │   │   │   │   ├── incidents/ # Incident management
│   │   │   │   │   ├── stats/  # Aggregated stats
│   │   │   │   │   └── regenerate/ # API key regeneration
│   │   │   └── auth/           # better-auth route (auto-delegated)
│   │   ├── v1/                 # API v1 - External ingestion
│   │   │   ├── logs/           # OTLP/HTTP log ingestion (POST)
│   │   │   └── ingest/         # Simple-ingest log format (POST)
│   │   ├── login/              # Public login page
│   │   ├── +layout.svelte      # Root layout
│   │   ├── +error.svelte       # Global error page
│   │   └── layout.css          # Root stylesheet
│   ├── app.d.ts                # TypeScript global definitions (App.Locals)
│   └── hooks.server.ts         # SvelteKit server hooks
├── tests/                      # Test suites
│   ├── integration/            # Integration tests (database, API endpoints)
│   │   ├── api/                # API handler tests
│   │   ├── auth/               # Authentication flow tests
│   │   ├── db/                 # Database operation tests
│   │   ├── hooks/              # Hook tests
│   │   ├── jobs/               # Job scheduler tests
│   │   ├── otlp/               # OTLP parsing tests
│   │   ├── simple-ingest/      # Simple-ingest format tests
│   │   └── server/             # Server utility tests
│   ├── e2e/                    # End-to-end tests (Playwright)
│   │   ├── helpers/            # Test utilities and fixtures
│   │   └── [*.spec.ts]         # Page flow tests
│   ├── fixtures/               # Test data and factory functions
│   ├── setup.ts                # Vitest global setup
│   └── [*.ts]                  # Shared test utilities
├── sdks/                       # Language-specific SDKs
│   ├── typescript/             # TypeScript/JavaScript SDK
│   ├── python/                 # Python SDK
│   └── go/                     # Go SDK
├── scripts/                    # Utility scripts (seed, backfill)
├── static/                     # Static files (favicon, etc.)
├── drizzle/                    # Database migrations
├── .github/workflows/          # CI/CD pipeline definitions
├── .planning/                  # GSD planning documents
│   └── codebase/               # Codebase analysis (this directory)
└── [config files]              # Build and tool configuration

```

## Directory Purposes

**`src/lib/server/`**
- Purpose: Server-only business logic and utilities
- Contains: Database access, authentication, authorization, OTLP parsing, incident grouping, API key validation
- Key files:
  - `db/schema.ts`: Drizzle table definitions (project, log, incident, user, session)
  - `db/index.ts`: Postgres client initialization
  - `auth.ts`: better-auth setup with lazy initialization
  - `events.ts`: In-memory event bus for log streaming
  - `error-handler.ts`: Centralized error logging and formatting
  - `session.ts`: Session utilities
  - `config/env.ts`: Environment variable validation
  - `config/performance.ts`: Performance tuning parameters
  - `jobs/cleanup-scheduler.ts`: Background log cleanup

**`src/lib/server/utils/`**
- Purpose: Reusable server utilities for validation and transformation
- Contains: API key validation and caching, OTLP mapping, incident fingerprinting, project ownership checks
- Key files:
  - `api-key.ts`: Generate, validate, cache API keys (5-min TTL)
  - `otlp.ts`: Normalize OTLP JSON to log schema
  - `incidents.ts`: Group logs by fingerprint, create/update incidents
  - `auth-guard.ts`: Require authentication (redirect to login)
  - `project-guard.ts`: Require project ownership (404 if not owned)
  - `search.ts`: Full-text search query building
  - `cursor.ts`: Cursor-based pagination encoding/decoding

**`src/routes/api/`**
- Purpose: REST API endpoints for web UI and external integrations
- Contains: Project CRUD, log queries with filtering/search, real-time streaming, incident management
- Structure: Mirror directory hierarchy matches data model (projects/[id]/logs, projects/[id]/incidents)

**`src/routes/v1/`**
- Purpose: External API for log ingestion (OTLP and simple-ingest formats)
- Contains: POST endpoints that validate API keys, normalize logs, update incidents
- Key endpoints:
  - `logs/+server.ts`: OTLP/HTTP JSON POST (main ingestion endpoint)
  - `ingest/+server.ts`: Simple-ingest format POST

**`src/routes/(app)/`**
- Purpose: Protected web UI routes requiring authentication
- Contains: Svelte pages for projects, logs, incidents, stats
- Pattern: Directory per major feature (projects/[id]/logs, projects/[id]/incidents)

**`src/lib/components/`**
- Purpose: Reusable UI components
- Contains: shadcn-svelte primitives (buttons, cards, dropdowns) + custom components
- Key custom components:
  - `filter-panel.svelte`: Log filtering UI
  - `incident-table.svelte`: Incident list view
  - `export-button.svelte`: CSV export trigger

**`src/lib/stores/`**
- Purpose: Svelte reactive stores for client-side state
- Contains: `createLogStreamStore()` for managing real-time log stream
- Pattern: Factory functions returning store interface

**`src/lib/shared/types.ts`**
- Purpose: Type definitions used by both client and server
- Contains: LogLevel enum, IncidentStatus, Incident types, validation schemas
- Key exports: LOG_LEVELS, INCIDENT_STATUSES, Zod schemas for runtime validation

**`tests/integration/`**
- Purpose: Integration tests with test database and realistic scenarios
- Contains: Tests for API handlers, auth flows, database operations, background jobs
- Pattern: Mirror src/ structure with .integration.test.ts suffix

**`tests/e2e/`**
- Purpose: End-to-end tests using Playwright browser automation
- Contains: User flow scenarios (login, create project, view logs, search)
- Key files: `helpers/` directory with fixture setup and utility functions

**`tests/fixtures/`**
- Purpose: Test data and factory functions
- Contains: Helper functions to create test projects, logs, users

**`drizzle/`**
- Purpose: Database migration history
- Contains: SQL migration files auto-generated by drizzle-kit
- Generated by: `bun run db:generate` command

## Key File Locations

**Entry Points:**
- `src/hooks.server.ts`: Server hook for request handling (auth, error handling)
- `src/routes/(app)/+layout.server.ts`: Protected app layout (enforces auth)
- `src/routes/login/+page.server.ts`: Login/signup page server logic

**Configuration:**
- `.env.example`: Environment variable reference documentation
- `tsconfig.json`: TypeScript compiler options
- `svelte.config.js`: SvelteKit and Svelte preprocessor config
- `vitest.config.ts`: Test runner configuration with 3 project types (unit, integration, component)
- `package.json`: Dependencies and build/test/dev scripts

**Core Logic:**
- `src/lib/server/db/schema.ts`: All table definitions with full-text search
- `src/lib/server/events.ts`: In-memory event bus for real-time streaming
- `src/lib/server/utils/incidents.ts`: Incident grouping and fingerprinting logic
- `src/lib/server/utils/api-key.ts`: API key validation with 5-minute cache
- `src/routes/v1/logs/+server.ts`: Main log ingestion endpoint

**Testing:**
- `tests/setup.ts`: Global test setup (database, fixtures)
- `tests/integration/db/`: Database operation tests
- `tests/integration/api/`: API endpoint tests
- `tests/e2e/helpers/`: Test utilities and fixture setup

## Naming Conventions

**Files:**
- Routes: `+server.ts` (API handler), `+page.svelte` (page UI), `+page.server.ts` (server load/actions)
- Tests: `*.unit.test.ts` (unit tests), `*.integration.test.ts` (integration tests), `*.component.test.ts` (component tests)
- Config: `{tool}.config.{js,ts}` (vite, vitest, svelte, etc.)
- Utilities: `{name}.ts` for modules, `{name}.unit.test.ts` for tests in same directory

**Components:**
- Svelte components: `PascalCase.svelte` (e.g., `LogTable.svelte`, `FilterPanel.svelte`)
- Primitives: `lowercase.svelte` (e.g., `button.svelte`, `card.svelte`)

**Functions:**
- Server utilities: `camelCase` (e.g., `validateApiKey()`, `requireProjectOwnership()`)
- Hooks: `useXxx()` or `createXxx()` (e.g., `createLogStreamStore()`)
- Type predicates: `isXxx()` (e.g., `isErrorResponse()`)

**Variables:**
- Constants: `UPPER_SNAKE_CASE` (e.g., `API_KEY_CACHE`, `MAX_BATCH_SIZE`)
- State variables: `camelCase` (e.g., `projectId`, `isLoading`)

**Types:**
- Interfaces: `PascalCase` (e.g., `ClientLog`, `IncidentLogInput`)
- Enums: `PascalCase` (e.g., `LogLevel`)
- Type aliases: `PascalCase` (e.g., `DatabaseClient`)

**Directories:**
- Feature directories: `kebab-case` (e.g., `log-cleanup`, `filter-panel`)
- Functional directories: `lowercase` (e.g., `utils`, `stores`, `hooks`)

## Where to Add New Code

**New Feature:**
- Primary code: `src/routes/api/projects/[id]/{feature}/+server.ts` (for API endpoints) or `src/routes/(app)/projects/[id]/{feature}/+page.svelte` (for UI)
- Server utilities: `src/lib/server/utils/{feature}.ts`
- Shared types: Add to `src/lib/shared/types.ts` or create `src/lib/shared/schemas/{feature}.ts`
- Integration tests: `tests/integration/{feature}/{feature}.integration.test.ts`
- E2E tests: `tests/e2e/{feature}.spec.ts`

**New Component/Module:**
- Reusable component: `src/lib/components/{FeatureName}.svelte`
- UI primitive: `src/lib/components/ui/{name}/{name}.svelte`
- Server utility: `src/lib/server/utils/{utility-name}.ts`
- Client store: `src/lib/stores/{store-name}.svelte.ts`

**Utilities:**
- Server-only helpers: `src/lib/server/utils/`
- Client-side helpers: `src/lib/utils/`
- Shared (both): `src/lib/shared/`

**Configuration:**
- Environment variables: Update `.env.example` and validate in `src/lib/server/config/env.ts`
- Performance tuning: Add to `src/lib/server/config/performance.ts` with bounds checking
- Feature flags: Add to `src/lib/server/config/env.ts`

## Special Directories

**`src/lib/server/db/`**
- Purpose: Database abstraction layer
- Generated: Migration files in `drizzle/` (auto-generated by drizzle-kit)
- Committed: `schema.ts`, `index.ts`, `migrate.ts` (source)
- Not committed: `drizzle/` contains auto-generated SQL

**`.svelte-kit/`**
- Purpose: SvelteKit internal build artifacts
- Generated: Yes, from src/ during build
- Committed: No, in .gitignore

**`build/`**
- Purpose: Production build output
- Generated: Yes, by `bun run build`
- Committed: No, in .gitignore

**`node_modules/`**
- Purpose: Installed dependencies
- Generated: Yes, by `bun install`
- Committed: No, in .gitignore

**`.env.* files`**
- Purpose: Environment configuration
- `.env.example`: Committed (reference documentation)
- `.env.local`, `.env`: Not committed (contains secrets)

**`tests/fixtures/`**
- Purpose: Reusable test data factories
- Pattern: Export helper functions for creating test entities
- Usage: Import in test files to create consistent test data

**`sdks/`**
- Purpose: Language-specific client SDKs for log ingestion
- Committed: Yes (source code)
- Deployment: Published to package registries (npm, PyPI, etc.)

---

*Structure analysis: 2026-02-26*
