# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5.9.3 - Full codebase, strict mode enabled
- Svelte 5.53.3 - UI components and pages with runes syntax

**Secondary:**
- JavaScript - Configuration files and some build tooling
- SQL - PostgreSQL via Drizzle ORM for database operations

## Runtime

**Environment:**
- Bun 1.0+ - JavaScript runtime and package manager
- Node.js compatible (fallback support)

**Package Manager:**
- Bun - Primary package manager
- Lockfile: `bun.lock` (present, committed)

## Frameworks

**Core:**
- SvelteKit 2.53.1 - Full-stack web framework
- Vite 7.3.1 - Build tool and dev server bundler
- svelte-adapter-bun 1.0.1 - Bun adapter for SvelteKit

**Database & ORM:**
- Drizzle ORM 0.45.1 - SQL ORM for type-safe database queries
- drizzle-kit 0.31.9 - Migration and schema management tool
- postgres.js 3.4.8 - PostgreSQL driver (used via Drizzle)

**Authentication:**
- better-auth 1.4.19 - Session-based authentication framework
- better-auth/plugins/username - Username plugin for authentication

**UI & Styling:**
- Tailwind CSS 4.2.1 - Utility-first CSS framework
- @tailwindcss/vite 4.2.1 - Vite plugin for Tailwind
- shadcn-svelte (bits-ui 2.16.2) - Component library with Svelte binding

**Testing:**
- Vitest 4.0.18 - Unit and integration test runner
- @playwright/test 1.58.2 - E2E browser testing
- @testing-library/svelte 5.3.1 - Component testing utilities
- @testing-library/jest-dom 6.9.1 - DOM matchers
- jsdom 28.1.0 - DOM simulation for component tests
- @vitest/browser 4.0.18 - Browser environment for tests
- @vitest/ui 4.0.18 - Visual test dashboard
- @vitest/coverage-v8 4.0.18 - Coverage reporting

**Development Tools:**
- @biomejs/biome 2.4.4 - Linting and code formatting
- svelte-check 4.4.3 - Svelte compiler checks
- TypeScript 5.9.3 - Type checking
- knip 5.85.0 - Unused exports/dependencies detection
- mode-watcher 1.1.0 - Dark/light mode management
- svelte-sonner 1.0.7 - Toast notifications

**Utilities:**
- Zod 4.3.6 - Schema validation
- nanoid 5.1.6 - Unique ID generation
- clsx 2.1.1 - Conditional CSS class composition
- tailwind-merge 3.5.0 - Merge Tailwind class conflicts
- tailwind-variants 3.2.2 - Component variant patterns
- layerchart 1.0.13 - Charting library
- tw-animate-css 1.4.0 - Animation utilities
- @lucide/svelte 0.575.0 - Icon library
- @internationalized/date 3.11.0 - Date utilities

## Configuration

**Environment:**
- `.env` file (see `.env.example` for schema)
- Environment validation at startup in `src/lib/server/config/env.ts`
- Separate config modules for different concerns:
  - `src/lib/server/config/env.ts` - Database, auth secrets, server config
  - `src/lib/server/config/performance.ts` - SSE, log stream, retention tuning
  - `src/lib/server/config/index.ts` - Unified exports

**Build Configuration:**
- `vite.config.ts` - Vite configuration with SvelteKit and Tailwind plugins
- `svelte.config.js` - SvelteKit adapter configuration (svelte-adapter-bun)
- `tsconfig.json` - TypeScript strict mode configuration
- `drizzle.config.ts` - Drizzle ORM migration settings
- `biome.json` - Linting and formatting rules
- `vitest.config.ts` - Test framework with multiple projects (unit, integration, component)
- `playwright.config.ts` - E2E test configuration

**Development Server:**
- Port: 5173 (dev mode)
- Port: 4173 (preview/production build)
- HMR enabled for hot module reloading
- Graceful error handling

## Platform Requirements

**Development:**
- Bun 1.0+
- PostgreSQL 15+ (via Docker Compose)
- Node.js 18+ (if using npm fallback)

**Production:**
- Bun 1.0+ or Node.js 18+
- PostgreSQL 15+ (externally hosted or containerized)
- Docker (optional, for containerized deployment via `compose.prod.yaml`)
- Reverse proxy support (configurable ORIGIN for CORS)

**Deployment Target:**
- Docker containers (via compose.prod.yaml)
- Kubernetes-compatible (standard container image)
- Self-hosted or cloud platforms (GCP, AWS, DigitalOcean, etc.)

## Architecture Decisions

**Chosen Stack Rationale:**
- **Bun**: Faster JS runtime with native TypeScript support, reduces build complexity
- **SvelteKit + Bun Adapter**: Full-stack framework with server-side rendering and API routes
- **Drizzle ORM**: Type-safe SQL queries with zero runtime overhead
- **PostgreSQL**: Robust relational database with full-text search (`tsvector`)
- **better-auth**: Self-hostable auth without external dependencies
- **Tailwind CSS**: Utility-first CSS for rapid UI development
- **Vitest**: Fast unit testing with great TypeScript support
- **Playwright**: Reliable E2E testing across browsers

## Key Dependencies Summary

**Critical (application will not run without these):**
- `better-auth` 1.4.19 - Session management and user authentication
- `drizzle-orm` 0.45.1 - Database layer
- `postgres` 3.4.8 - PostgreSQL connection
- `@sveltejs/kit` 2.53.1 - Web framework
- `svelte` 5.53.3 - Component framework
- `zod` 4.3.6 - Runtime validation for API requests

**Infrastructure:**
- `tailwindcss` 4.2.1 - CSS generation
- `vite` 7.3.1 - Module bundling
- `nanoid` 5.1.6 - Safe ID generation for resources

**Development-only:**
- All testing frameworks (vitest, playwright, testing-library)
- `biome` 2.4.4 - Code quality tools
- `drizzle-kit` 0.31.9 - Migration CLI

---

*Stack analysis: 2026-02-26*
