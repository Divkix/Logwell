# sv-logger Implementation Plan

> TDD + Testing Trophy Methodology | SvelteKit + Drizzle + better-auth

---

## Philosophy: Testing Trophy Approach

Following [Kent C. Dodds' Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications), we prioritize:

1. **Static Analysis** (base) - TypeScript strict mode + Biome ✅ Already configured
2. **Integration Tests** (largest) - Test components/routes with real database interactions
3. **Unit Tests** (smaller) - Pure functions, utilities, validation logic
4. **E2E Tests** (top) - Critical user flows via Playwright

**Key Principle:** "The more your tests resemble the way your software is used, the more confidence they can give you."

### Testing Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Static | TypeScript + Biome | Type safety, linting |
| Unit/Integration | Vitest + PGlite | Fast tests with real PostgreSQL (in-memory) |
| Component | Vitest Browser Mode | Real browser testing for Svelte components |
| E2E | Playwright | Full user journey testing |

---

## Phase 0: Testing Infrastructure Setup

> Establish the testing foundation before any feature work.

### Step 0.1: Install Testing Dependencies

**Commit:** `feat: add Vitest and Playwright testing infrastructure`

```bash
bun add -D vitest @vitest/coverage-v8 @vitest/browser vitest-browser-svelte
bun add -D @electric-sql/pglite drizzle-orm/pglite
bun add -D @playwright/test @types/node
bun add -D @testing-library/svelte @testing-library/jest-dom
```

**Files to create:**
- `vitest.config.ts` - Main Vitest configuration
- `vitest.workspace.ts` - Workspace for server/client test separation
- `playwright.config.ts` - Playwright E2E configuration
- `src/lib/server/db/test-utils.ts` - PGlite test database helpers
- `tests/setup.ts` - Global test setup

**Verification:** `bun run test` executes without errors

---

### Step 0.2: Configure Test Database with PGlite

**Commit:** `feat: add PGlite in-memory database for testing`

Create test utilities that:
- Spin up in-memory PostgreSQL via PGlite
- Apply Drizzle schema migrations
- Provide cleanup between tests
- Export typed database helpers

**Files:**
- `src/lib/server/db/test-db.ts` - PGlite database factory
- `tests/fixtures/db.ts` - Database fixtures and seeders

**Test:** Write first integration test that creates/reads from test database

---

### Step 0.3: Add npm Scripts for Testing

**Commit:** `chore: add test scripts to package.json`

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:e2e": "playwright test",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

---

## Phase 1: Database Schema & Core Types

> Build the data layer with full test coverage.

### Step 1.1: Define Log Level Enum and Project Table

**Commit:** `feat: add project table schema with tests`

**TDD Flow:**
1. Write integration test: "should create a project with API key"
2. Write integration test: "should enforce unique project names"
3. Write integration test: "should find project by API key"
4. Implement `project` table in `schema.ts`
5. Run `bun run db:generate` and verify migration

**Schema (from PRD):**
```typescript
export const project = pgTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_project_api_key').on(table.apiKey),
]);
```

**Tests:** `src/lib/server/db/__tests__/project.test.ts`

---

### Step 1.2: Define Log Table with Full-Text Search

**Commit:** `feat: add log table schema with tsvector search`

**TDD Flow:**
1. Write test: "should insert log entry with all fields"
2. Write test: "should cascade delete logs when project deleted"
3. Write test: "should search logs by message content"
4. Write test: "should search logs by metadata content"
5. Implement `log` table with tsvector generated column
6. Verify indexes are created

**Schema highlights:**
- Custom tsvector type for Drizzle
- `log_level` enum (debug, info, warn, error, fatal)
- Generated `search` column combining message + metadata
- GIN index with `fastupdate` for write performance

**Tests:** `src/lib/server/db/__tests__/log.test.ts`

---

### Step 1.3: Create Type Exports and Validation Schemas

**Commit:** `feat: add Zod validation schemas for API payloads`

**Install:** `bun add zod`

**TDD Flow:**
1. Write unit tests for log payload validation
2. Write unit tests for project creation validation
3. Implement Zod schemas matching PRD specifications

**Files:**
- `src/lib/shared/schemas/log.ts` - Log ingestion schemas
- `src/lib/shared/schemas/project.ts` - Project management schemas
- `src/lib/shared/types.ts` - Shared type exports

**Tests:** `src/lib/shared/schemas/__tests__/`

---

## Phase 2: Utility Functions & Helpers

> Pure functions with unit tests.

### Step 2.1: API Key Generation and Validation

**Commit:** `feat: add API key generation with caching`

**Install:** `bun add nanoid`

**TDD Flow:**
1. Write unit test: "generateApiKey returns svl_ prefixed 32-char string"
2. Write unit test: "validateApiKeyFormat rejects malformed keys"
3. Write integration test: "validateApiKey returns projectId for valid key"
4. Write integration test: "validateApiKey caches validated keys"
5. Write integration test: "invalidateApiKeyCache removes cached entry"
6. Implement `src/lib/server/utils/api-key.ts`

**Tests:** `src/lib/server/utils/__tests__/api-key.test.ts`

---

### Step 2.2: Date/Time Formatting Utilities

**Commit:** `feat: add date formatting utilities`

**TDD Flow:**
1. Write unit test: "formatTimestamp returns HH:mm:ss.SSS format"
2. Write unit test: "formatRelativeTime returns human-readable duration"
3. Write unit test: "getTimeRangeStart returns correct Date for each range"
4. Implement `src/lib/utils/format.ts`

**Tests:** `src/lib/utils/__tests__/format.test.ts`

---

### Step 2.3: Full-Text Search Query Builder

**Commit:** `feat: add full-text search query helpers`

**TDD Flow:**
1. Write unit test: "buildSearchQuery converts space-separated terms to tsquery"
2. Write unit test: "buildSearchQuery escapes special characters"
3. Write integration test: "searchLogs returns matching logs ordered by rank"
4. Implement `src/lib/server/utils/search.ts`

**Tests:** `src/lib/server/utils/__tests__/search.test.ts`

---

### Step 2.4: Log Level Color Mappings

**Commit:** `feat: add log level color utilities`

**TDD Flow:**
1. Write unit test: "getLevelColor returns correct HSL for each level"
2. Write unit test: "getLevelBgClass returns Tailwind class for each level"
3. Implement `src/lib/utils/colors.ts`

**Tests:** `src/lib/utils/__tests__/colors.test.ts`

---

## Phase 3: Authentication System

> better-auth integration with session management.

### Step 3.1: Configure better-auth Server

**Commit:** `feat: add better-auth server configuration`

**Install:** `bun add better-auth`

**TDD Flow:**
1. Write integration test: "auth.api.signUpEmail creates user"
2. Write integration test: "auth.api.signInEmail returns session"
3. Write integration test: "auth.api.getSession returns null for invalid session"
4. Configure `src/lib/server/auth.ts` with Drizzle adapter
5. Generate better-auth schema tables

**Files:**
- `src/lib/server/auth.ts` - better-auth configuration
- `src/lib/auth-client.ts` - Client-side auth helper

**Tests:** `src/lib/server/__tests__/auth.test.ts`

---

### Step 3.2: Implement Server Hooks

**Commit:** `feat: add authentication server hooks`

**TDD Flow:**
1. Write integration test: "hook populates event.locals.user for valid session"
2. Write integration test: "hook returns null for invalid session"
3. Write integration test: "hook handles better-auth routes"
4. Implement `src/hooks.server.ts`
5. Update `src/app.d.ts` with Locals types

**Tests:** `src/hooks.server.test.ts`

---

### Step 3.3: Create Admin User Seeding

**Commit:** `feat: add admin user seeding script`

**TDD Flow:**
1. Write script that creates admin user on first run
2. Use ADMIN_PASSWORD from environment
3. Skip if admin already exists
4. Implement `scripts/seed-admin.ts`

**Run:** `bun run db:seed`

---

## Phase 4: API Routes - Log Ingestion

> Public API endpoints with comprehensive integration tests.

### Step 4.1: OTLP/HTTP Log Ingestion Endpoint

**Commit:** `feat: add POST /v1/logs endpoint`

**TDD Flow:**
1. Write integration test: "returns 401 without Authorization header"
2. Write integration test: "returns 401 with invalid API key"
3. Write integration test: "returns 400 for invalid OTLP payload"
4. Write integration test: "ingests OTLP log records"
5. Write integration test: "returns partial success when some records rejected"
6. Implement `src/routes/v1/logs/+server.ts`

**Tests:** `tests/integration/otlp/logs.integration.test.ts`

---

## Phase 5: API Routes - Project Management

> Protected endpoints requiring session authentication.

### Step 5.1: Auth Guard Utility

**Commit:** `feat: add session authentication guard`

**TDD Flow:**
1. Write integration test: "requireAuth throws redirect for unauthenticated"
2. Write integration test: "requireAuth returns session for authenticated"
3. Implement `src/lib/server/utils/auth-guard.ts`

**Tests:** `src/lib/server/utils/__tests__/auth-guard.test.ts`

---

### Step 5.2: List and Create Projects

**Commit:** `feat: add GET/POST /api/projects endpoints`

**TDD Flow:**
1. Write integration test: "GET returns empty array when no projects"
2. Write integration test: "GET returns projects with log counts"
3. Write integration test: "POST creates project with generated API key"
4. Write integration test: "POST returns 400 for duplicate name"
5. Implement `src/routes/api/projects/+server.ts`

**Tests:** `src/routes/api/projects/__tests__/server.test.ts`

---

### Step 5.3: Project Detail, Delete, Regenerate Key

**Commit:** `feat: add project detail and management endpoints`

**TDD Flow:**
1. Write integration test: "GET /api/projects/[id] returns project with stats"
2. Write integration test: "DELETE /api/projects/[id] removes project and logs"
3. Write integration test: "POST /api/projects/[id]/regenerate returns new key"
4. Write integration test: "POST /api/projects/[id]/regenerate invalidates old key"
5. Implement routes under `src/routes/api/projects/[id]/`

**Tests:** `src/routes/api/projects/[id]/__tests__/`

---

### Step 5.4: Log Query Endpoint

**Commit:** `feat: add GET /api/projects/[id]/logs with filtering`

**TDD Flow:**
1. Write integration test: "returns logs ordered by timestamp DESC"
2. Write integration test: "respects limit parameter (100-500)"
3. Write integration test: "filters by level parameter"
4. Write integration test: "filters by time range (from/to)"
5. Write integration test: "performs full-text search"
6. Write integration test: "returns total count and has_more flag"
7. Implement `src/routes/api/projects/[id]/logs/+server.ts`

**Tests:** `src/routes/api/projects/[id]/logs/__tests__/server.test.ts`

---

### Step 5.5: Stats Endpoint

**Commit:** `feat: add GET /api/projects/[id]/stats endpoint`

**TDD Flow:**
1. Write integration test: "returns level distribution counts"
2. Write integration test: "calculates percentages correctly"
3. Write integration test: "respects time range parameters"
4. Implement `src/routes/api/projects/[id]/stats/+server.ts`

**Tests:** `src/routes/api/projects/[id]/stats/__tests__/server.test.ts`

---

## Phase 6: Real-Time SSE Infrastructure

> Server-Sent Events for live log streaming.

### Step 6.1: In-Memory Event Bus

**Commit:** `feat: add in-memory log event bus`

**Install:** `bun add sveltekit-sse`

**TDD Flow:**
1. Write unit test: "emitLog triggers registered listeners"
2. Write unit test: "onLog returns unsubscribe function"
3. Write unit test: "unsubscribe removes listener"
4. Write unit test: "events are project-scoped"
5. Implement `src/lib/server/events.ts`

**Tests:** `src/lib/server/__tests__/events.test.ts`

---

### Step 6.2: SSE Stream Endpoint

**Commit:** `feat: add SSE log streaming endpoint`

**TDD Flow:**
1. Write integration test: "returns SSE content-type header"
2. Write integration test: "emits logs when event bus fires"
3. Write integration test: "batches logs within 1.5s window"
4. Write integration test: "sends heartbeat every 30s"
5. Write integration test: "cleans up on disconnect"
6. Implement `src/routes/api/projects/[id]/logs/stream/+server.ts`

**Tests:** `src/routes/api/projects/[id]/logs/stream/__tests__/server.test.ts`

---

### Step 6.3: Wire Event Bus to Log Ingestion

**Commit:** `feat: emit events on log ingestion`

**TDD Flow:**
1. Write integration test: "POST /v1/logs emits to event bus"
3. Update log ingestion routes to call `logEventBus.emitLog()`

---

## Phase 7: UI Components (shadcn-svelte)

> Component-driven development with Vitest Browser Mode.

### Step 7.1: Initialize shadcn-svelte

**Commit:** `feat: initialize shadcn-svelte with base components`

```bash
bunx shadcn-svelte@latest init
bunx shadcn-svelte@latest add button input select dialog sheet card \
  table badge switch separator skeleton sonner
```

**Files created:**
- `src/lib/components/ui/*` - shadcn components
- `src/lib/utils/cn.ts` - Class name utility
- `components.json` - shadcn configuration

---

### Step 7.2: Theme Toggle Component

**Commit:** `feat: add theme toggle component`

**Install:** `bun add mode-watcher`

**TDD Flow:**
1. Write component test: "renders sun icon in light mode"
2. Write component test: "renders moon icon in dark mode"
3. Write component test: "toggles theme on click"
4. Implement `src/lib/components/theme-toggle.svelte`
5. Implement `src/lib/stores/theme.svelte.ts`

**Tests:** `src/lib/components/__tests__/theme-toggle.test.ts`

---

### Step 7.3: Level Badge Component

**Commit:** `feat: add log level badge component`

**TDD Flow:**
1. Write component test: "renders correct color for each level"
2. Write component test: "displays level text uppercase"
3. Implement `src/lib/components/level-badge.svelte`

**Tests:** `src/lib/components/__tests__/level-badge.test.ts`

---

### Step 7.4: Project Card Component

**Commit:** `feat: add project card component`

**TDD Flow:**
1. Write component test: "displays project name"
2. Write component test: "displays log count formatted"
3. Write component test: "displays relative last activity"
4. Write component test: "View Logs button navigates correctly"
5. Implement `src/lib/components/project-card.svelte`

**Tests:** `src/lib/components/__tests__/project-card.test.ts`

---

### Step 7.5: Search Input Component

**Commit:** `feat: add debounced search input component`

**TDD Flow:**
1. Write component test: "renders search icon"
2. Write component test: "debounces input by 300ms"
3. Write component test: "emits search event with value"
4. Implement `src/lib/components/search-input.svelte`

**Tests:** `src/lib/components/__tests__/search-input.test.ts`

---

### Step 7.6: Time Range Picker Component

**Commit:** `feat: add time range picker component`

**TDD Flow:**
1. Write component test: "renders 15m, 1h, 24h, 7d options"
2. Write component test: "highlights selected range"
3. Write component test: "emits change event with range value"
4. Implement `src/lib/components/time-range-picker.svelte`

**Tests:** `src/lib/components/__tests__/time-range-picker.test.ts`

---

### Step 7.7: Live Toggle Component

**Commit:** `feat: add live streaming toggle component`

**TDD Flow:**
1. Write component test: "shows green pulse when enabled"
2. Write component test: "toggles state on click"
3. Write component test: "emits change event"
4. Implement `src/lib/components/live-toggle.svelte`

**Tests:** `src/lib/components/__tests__/live-toggle.test.ts`

---

### Step 7.8: Log Row Component

**Commit:** `feat: add log row component`

**TDD Flow:**
1. Write component test: "displays timestamp in HH:mm:ss.SSS format"
2. Write component test: "displays level badge"
3. Write component test: "truncates long messages with ellipsis"
4. Write component test: "emits click event for detail view"
5. Implement `src/lib/components/log-row.svelte`

**Tests:** `src/lib/components/__tests__/log-row.test.ts`

---

### Step 7.9: Log Table Component

**Commit:** `feat: add log table component with virtualization prep`

**TDD Flow:**
1. Write component test: "renders header row"
2. Write component test: "renders log rows"
3. Write component test: "shows skeleton during loading"
4. Write component test: "shows empty state when no logs"
5. Implement `src/lib/components/log-table.svelte`

**Tests:** `src/lib/components/__tests__/log-table.test.ts`

---

### Step 7.10: Log Detail Modal Component

**Commit:** `feat: add log detail modal component`

**TDD Flow:**
1. Write component test: "displays all log fields"
2. Write component test: "formats timestamp as full date"
3. Write component test: "pretty-prints metadata JSON"
4. Write component test: "copy buttons copy values to clipboard"
5. Write component test: "closes on Escape key"
6. Write component test: "closes on overlay click"
7. Implement `src/lib/components/log-detail-modal.svelte`

**Tests:** `src/lib/components/__tests__/log-detail-modal.test.ts`

---

### Step 7.11: Project Settings Modal

**Commit:** `feat: add project settings modal component`

**TDD Flow:**
1. Write component test: "displays API key"
2. Write component test: "copy button copies API key"
3. Write component test: "regenerate button triggers confirmation"
4. Write component test: "delete requires typing project name"
5. Write component test: "shows usage example with curl"
6. Implement `src/lib/components/project-settings.svelte`

**Tests:** `src/lib/components/__tests__/project-settings.test.ts`

---

### Step 7.12: Level Distribution Chart

**Commit:** `feat: add donut chart for level distribution`

**TDD Flow:**
1. Write component test: "renders donut chart with correct segments"
2. Write component test: "displays legend with percentages"
3. Write component test: "uses correct colors for each level"
4. Implement `src/lib/components/level-chart.svelte`

**Tests:** `src/lib/components/__tests__/level-chart.test.ts`

---

## Phase 8: Page Routes

> Full page implementations with server-side data loading.

### Step 8.1: Login Page

**Commit:** `feat: add login page`

**TDD Flow:**
1. Write E2E test: "redirects to / after successful login"
2. Write E2E test: "shows error for invalid credentials"
3. Write E2E test: "Enter key submits form"
4. Implement `src/routes/login/+page.svelte`
5. Implement `src/routes/login/+page.server.ts`

**Tests:** `tests/e2e/login.spec.ts`

---

### Step 8.2: App Layout with Auth Guard

**Commit:** `feat: add protected app layout`

**TDD Flow:**
1. Write E2E test: "redirects to /login when unauthenticated"
2. Write E2E test: "renders header with logout button"
3. Write E2E test: "logout redirects to /login"
4. Implement `src/routes/(app)/+layout.svelte`
5. Implement `src/routes/(app)/+layout.server.ts`

**Tests:** `tests/e2e/auth-guard.spec.ts`

---

### Step 8.3: Dashboard (Project List)

**Commit:** `feat: add dashboard with project list`

**TDD Flow:**
1. Write E2E test: "displays project cards"
2. Write E2E test: "create project modal works"
3. Write E2E test: "navigates to project on card click"
4. Write E2E test: "shows empty state when no projects"
5. Implement `src/routes/(app)/+page.svelte`
6. Implement `src/routes/(app)/+page.server.ts`

**Tests:** `tests/e2e/dashboard.spec.ts`

---

### Step 8.4: Project Log Stream Page

**Commit:** `feat: add project log stream page`

**TDD Flow:**
1. Write E2E test: "displays log table with entries"
2. Write E2E test: "live toggle enables SSE streaming"
3. Write E2E test: "search filters logs"
4. Write E2E test: "level filter works"
5. Write E2E test: "time range filter works"
6. Write E2E test: "clicking row opens detail modal"
7. Write E2E test: "settings button opens settings modal"
8. Implement `src/routes/(app)/projects/[id]/+page.svelte`
9. Implement `src/routes/(app)/projects/[id]/+page.server.ts`

**Tests:** `tests/e2e/log-stream.spec.ts`

---

### Step 8.5: Project Stats Page

**Commit:** `feat: add project stats page with charts`

**TDD Flow:**
1. Write E2E test: "displays donut chart"
2. Write E2E test: "time range changes chart data"
3. Write E2E test: "displays total log count"
4. Implement `src/routes/(app)/projects/[id]/stats/+page.svelte`
5. Implement `src/routes/(app)/projects/[id]/stats/+page.server.ts`

**Tests:** `tests/e2e/stats.spec.ts`

---

## Phase 9: Real-Time Client Integration

> Connect SSE to UI with Svelte 5 runes.

### Step 9.1: Log Stream Store

**Commit:** `feat: add reactive log stream store`

**TDD Flow:**
1. Write unit test: "initializes with empty logs array"
2. Write unit test: "prepends new logs maintaining maxLogs limit"
3. Write unit test: "clears logs on project change"
4. Implement `src/lib/stores/logs.svelte.ts`

**Tests:** `src/lib/stores/__tests__/logs.test.ts`

---

### Step 9.2: SSE Client Hook

**Commit:** `feat: add SSE subscription hook`

**TDD Flow:**
1. Write integration test: "connects to SSE endpoint"
2. Write integration test: "parses incoming log batches"
3. Write integration test: "handles reconnection"
4. Write integration test: "cleans up on unmount"
5. Implement `src/lib/hooks/use-log-stream.svelte.ts`

**Tests:** `src/lib/hooks/__tests__/use-log-stream.test.ts`

---

### Step 9.3: Wire Live Toggle to Stream

**Commit:** `feat: connect live toggle to SSE stream`

**TDD Flow:**
1. Write E2E test: "enabling live starts receiving logs"
2. Write E2E test: "disabling live stops stream"
3. Write E2E test: "search pauses live with notice"
4. Update `src/routes/(app)/projects/[id]/+page.svelte`

**Tests:** `tests/e2e/live-stream.spec.ts`

---

## Phase 10: Polish & Performance

> Final refinements and optimizations.

### Step 10.1: Loading States and Skeletons

**Commit:** `feat: add loading skeletons to all pages`

- Dashboard skeleton
- Log table skeleton
- Stats page skeleton
- Ensure no layout shifts

---

### Step 10.2: Error Boundaries and Toast Notifications

**Commit:** `feat: add error handling and toast notifications`

**Install:** Sonner is already included via shadcn

- Add error boundaries to routes
- Add success/error toasts for all mutations
- Add global error handler in hooks

---

### Step 10.3: Responsive Design

**Commit:** `feat: add mobile-responsive layouts`

- Collapsible filters on mobile
- Card-based log layout option
- Bottom navigation for mobile
- Test at all breakpoints

---

### Step 10.4: Accessibility Audit

**Commit:** `fix: accessibility improvements`

- Keyboard navigation
- ARIA labels
- Focus management in modals
- Color contrast verification

---

### Step 10.5: Performance Optimization

**Commit:** `perf: optimize bundle and runtime performance`

- Verify code splitting works
- Add `loading="lazy"` where appropriate
- Optimize SSE batching parameters
- Profile and fix any bottlenecks

---

## Phase 11: Documentation & Deployment

### Step 11.1: Environment Configuration

**Commit:** `docs: update environment configuration`

- Update `.env.example` with all required variables
- Document each variable's purpose
- Add validation in startup

---

### Step 11.2: Docker Production Build

**Commit:** `feat: add production Docker configuration`

- Multi-stage Dockerfile
- Docker Compose for production
- Health check endpoint

---

### Step 11.3: CI/CD Pipeline

**Commit:** `ci: add GitHub Actions workflow`

- Run tests on PR
- Type checking
- Linting
- E2E tests with Playwright
- Build verification

---

## Summary: Commit Sequence

| Phase | Commits | Focus |
|-------|---------|-------|
| 0 | 3 | Testing infrastructure |
| 1 | 3 | Database schema |
| 2 | 4 | Utility functions |
| 3 | 3 | Authentication |
| 4 | 2 | Log ingestion API |
| 5 | 5 | Project management API |
| 6 | 3 | Real-time SSE |
| 7 | 12 | UI components |
| 8 | 5 | Page routes |
| 9 | 3 | Client SSE integration |
| 10 | 5 | Polish & performance |
| 11 | 3 | Docs & deployment |

**Total: ~51 commits**

---

## Testing Metrics Target

| Metric | Target |
|--------|--------|
| Line Coverage | > 80% |
| Branch Coverage | > 75% |
| Integration Tests | > 60% of test suite |
| E2E Tests | All critical user flows |
| Build Time | < 30s |
| Test Suite Time | < 60s (unit/integration) |

---

## Sources & References

- [SvelteKit Testing Docs](https://svelte.dev/docs/svelte/testing)
- [Testing Trophy - Kent C. Dodds](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [Drizzle + PGlite Testing](https://github.com/rphlmr/drizzle-vitest-pg)
- [better-auth SvelteKit Integration](https://www.better-auth.com/docs/integrations/svelte-kit)
- [shadcn-svelte Installation](https://www.shadcn-svelte.com/docs/installation/sveltekit)
- [Tailwind CSS v4 + SvelteKit](https://tailwindcss.com/docs/guides/sveltekit)
- [sveltekit-sse](https://github.com/razshare/sveltekit-sse)
- [Vitest Browser Mode](https://scottspence.com/posts/testing-with-vitest-browser-svelte-guide)

---

*Document Version: 1.0*
*Created: January 2025*
