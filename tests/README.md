# Testing Infrastructure

This project follows the Testing Trophy methodology, prioritizing integration tests while maintaining comprehensive coverage across all test types.

## Test Structure

### Unit Tests (`.unit.test.ts`)

Located alongside source files in `src/`. Tests pure functions and utilities in isolation.

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

## Running Tests

```bash
# Run all tests (unit + integration)
pnpm run test

# Run tests in watch mode
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

## Coverage Thresholds

The project maintains the following coverage thresholds:

- Lines: 75%
- Functions: 75%
- Branches: 65%
- Statements: 75%

## Tech Stack

- **Test Runner:** Vitest 4
- **E2E Framework:** Playwright
- **Component Testing:** @testing-library/svelte
- **Assertions:** @testing-library/jest-dom
- **Test Database:** PGlite (in-memory PostgreSQL)
