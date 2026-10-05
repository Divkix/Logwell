# Testing Infrastructure

This project follows the Testing Trophy methodology: confidence per test, weighted toward integration. Test tiers are selected by filename suffix, and each tier runs with its own command.

## Test Structure

### Unit Tests (`.unit.test.ts`)

Located alongside source files in `src/`. Cover the boundaries higher tiers cannot reach cheaply: parsers, validators, security-sensitive configuration, state machines.

```bash
pnpm run test:unit
```

### Integration Tests (`.integration.test.ts`)

Located in `tests/integration/`. Tests server-side code with database interactions using PGlite.

```bash
pnpm run test:integration
```

### Component Tests (`.component.test.ts`)

Located alongside source files in `src/`. Tests Svelte components in jsdom using `@testing-library/svelte`.

```bash
pnpm run test:component
```

### E2E Tests

Located in `tests/e2e/`. Full end-to-end tests using Playwright across multiple browsers.

```bash
pnpm run test:e2e
```

## What Belongs in Which Tier

- **Integration carries the weight.** Orchestration — routes, DB, auth, CSRF, ingest pipeline, SSE streams — runs through the real handler against PGlite.
- **Unit tests hold the boundaries.** Parsers, validators, security-sensitive configuration, and state machines stay unit-tested where integration cannot exercise them cheaply.
- **No overlapping assertions.** If a higher tier already asserts a behavior, do not re-assert it below. A component test that mocks or re-implements a module does not count as coverage of that module.
- **Table tests keep their inputs.** Deduplicate rows freely, but preserve every distinct boundary, type, and error input.
- **No coverage quotas.** Coverage is a signal for finding untested behavior, never a target, and no tier carries a required case count.

## Running Tests

```bash
# Run all Vitest tiers (unit + component + integration)
pnpm run test

# Run specific test types
pnpm run test:unit
pnpm run test:component
pnpm run test:integration
pnpm run test:e2e

# Generate coverage report
pnpm run test:coverage

# Open test UI
pnpm run test:ui
```

## Test Database

Integration tests use PGlite, an in-memory PostgreSQL database. The engine lives in `src/lib/server/db/test-db.ts`:

- `createTestDatabase()` - Creates a fresh PGlite instance
- `cleanDatabase()` - Truncates all tables
- `setupTestDatabase()` - Returns db and cleanup function

Seeding helpers live in `tests/fixtures/db.ts` (`seedProject`, `seedLog`, `seedProjectWithApiKey`, `getOrCreateDefaultUser`).

### Example Integration Test

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { setupTestDatabase } from "../../src/lib/server/db/test-db";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "../../src/lib/server/db/schema";

describe("My Integration Test", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should test database interaction", async () => {
    // Your test here
  });
});
```

## Coverage

Coverage is collected with the v8 provider via `pnpm run test:coverage`. It is signal-only: `vitest.config.ts` defines no coverage thresholds and CI runs the report without a gate. Use it to find untested behavior, not as a target.

## Tech Stack

- **Test Runner:** Vitest 5 (via Vite+)
- **E2E Framework:** Playwright
- **Component Testing:** @testing-library/svelte
- **Assertions:** @testing-library/jest-dom
- **Test Database:** PGlite (in-memory PostgreSQL)
