# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:**
- Framework: Vitest 4.0.18
- Config: `vitest.config.ts`
- Globals: true (test functions available without import)

**Assertion Library:**
- Vitest's built-in expect (extends with @testing-library/jest-dom matchers)

**Run Commands:**
```bash
bun run test              # Run all tests (unit, integration, component)
bun run test:unit         # Run unit tests only
bun run test:integration  # Run integration tests only
bun run test:component    # Run component tests only (jsdom)
bun run test:coverage     # Run all with coverage report
bun run test:ui           # Open interactive test UI
```

## Test File Organization

**Location:**
- Unit tests: co-located in `src/**/*.unit.test.ts`
- Component tests: co-located in `src/**/__tests__/*.component.test.ts`
- Integration tests: separate in `tests/integration/**/*.integration.test.ts`
- E2E tests: separate in `tests/e2e/**/*.spec.ts` (Playwright, not Vitest)

**Naming:**
- File suffix indicates test type: `.unit.test.ts`, `.component.test.ts`, `.integration.test.ts`
- Test files grouped by feature/module in `__tests__` subdirectories
- E2E tests use `.spec.ts` suffix (Playwright convention)

**Structure:**
```
src/
├── lib/
│   ├── utils/
│   │   ├── format.ts
│   │   └── format.unit.test.ts          # Co-located unit test
│   ├── server/
│   │   ├── utils/
│   │   │   ├── api-key.ts
│   │   │   └── api-key.unit.test.ts     # Co-located unit test
│   ├── components/
│   │   ├── log-card.svelte
│   │   └── __tests__/
│   │       └── log-card.component.test.ts  # Component test
tests/
├── integration/
│   ├── api/
│   │   └── projects/
│   │       └── server.integration.test.ts
│   └── db/
│       └── project.integration.test.ts
├── e2e/
│   ├── auth-guard.spec.ts
│   └── dashboard.spec.ts
├── fixtures/
│   └── db.ts                            # Shared test factories
└── setup.ts                             # Global test setup
```

## Test Structure

**Suite Organization:**
```typescript
describe('formatTimestamp', () => {
  it.each([
    ['2024-01-15T14:30:45.123Z', '14:30:45.123', 'afternoon time'],
    ['2024-01-15T09:15:30.456Z', '09:15:30.456', 'morning time'],
  ])('formatTimestamp(%s) returns %s (%s)', (input, expected) => {
    expect(formatTimestamp(new Date(input))).toBe(expected);
  });

  it('handles Date object at the start of epoch', () => {
    const date = new Date(0);
    expect(formatTimestamp(date)).toBe('00:00:00.000');
  });
});
```

**Patterns:**
- `describe()` blocks group related tests by feature/function
- `it()` tests are named descriptively as sentences: "formatTimestamp(%s) returns %s"
- Use `it.each()` for parametrized tests with multiple inputs/outputs (see `src/lib/utils/format.unit.test.ts` lines 4-23)
- Nested `describe()` blocks for sub-features (e.g., "seconds range", "minutes range" in format tests)

**Setup/Teardown:**
- `beforeEach()` initializes test state (database, authentication)
- `afterEach()` cleans up resources (`cleanup()` from @testing-library/svelte, `vi.clearAllMocks()`)
- Global setup in `tests/setup.ts` configures environment variables and jest-dom matchers
- Test database uses `beforeEach()` with cleanup function: `cleanup = setup.cleanup` (see `tests/integration/api/projects/server.integration.test.ts` lines 70-99)

**Example from codebase (src/lib/utils/format.unit.test.ts, lines 26-93):**
```typescript
describe('formatRelativeTime', () => {
  const now = new Date('2024-01-15T14:30:45.000Z');

  describe('seconds range', () => {
    it.each([
      [0, 'just now', 'current time'],
      [4 * 1000, 'just now', 'less than 5 seconds ago'],
      [5 * 1000, '5 seconds ago', '5 seconds ago'],
    ])('formatRelativeTime(%i ms ago) returns "%s" (%s)', (offset, expected) => {
      const date = new Date(now.getTime() - offset);
      expect(formatRelativeTime(date, now)).toBe(expected);
    });
  });
});
```

## Mocking

**Framework:** Vitest's `vi` module

**Patterns:**
- Use `vi.fn()` for function mocks that track calls
- Use `vi.mock()` for module mocking (see `src/lib/components/__tests__/log-card.component.test.ts` lines 7-15)
- Module mock example:
```typescript
vi.mock('$lib/utils/format', () => ({
  formatTimestamp: vi.fn((date: Date) => {
    // Deterministic mock implementation
    const hours = date.getUTCHours().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }),
}));
```

- Call tracking:
```typescript
const onclick = vi.fn();
render(LogCard, { props: { log: baseLog, onclick } });
// ...
expect(onclick).toHaveBeenCalledTimes(1);
expect(onclick).toHaveBeenCalledWith(baseLog);
```

- Clear mocks after each test: `afterEach(() => { vi.clearAllMocks(); })`

**What to Mock:**
- External module dependencies (utilities, formatters)
- Event handlers and callbacks
- API responses (in integration tests, use real database instead when possible)

**What NOT to Mock:**
- Database queries in integration tests (use real test database via PGlite)
- Core language features or built-ins
- Authentication system (test via real auth.api calls with test database)
- Business logic that should be tested end-to-end

## Fixtures and Factories

**Test Data:**
Factories in `tests/fixtures/db.ts`:

```typescript
/**
 * Factory function to create test projects
 */
export function createProjectFactory(
  overrides: Partial<ProjectInsert> & { ownerId: string },
): ProjectInsert {
  return {
    id: nanoid(),
    name: `test-project-${nanoid(8)}`,
    apiKey: generateApiKey(),
    ...overrides,
  };
}

/**
 * Factory function to create test logs
 */
export function createLogFactory(overrides: Partial<LogInsert> = {}): LogInsert {
  return {
    id: nanoid(),
    projectId: overrides.projectId || nanoid(),
    level: 'info',
    message: `Test log message ${nanoid(8)}`,
    // ... other defaults
    ...overrides,
  };
}
```

**Component Test Data Example (src/lib/components/__tests__/log-card.component.test.ts, lines 18-51):**
```typescript
const baseLog: Log = {
  id: 'log_123',
  projectId: 'proj_456',
  level: 'info',
  message: 'User logged in successfully',
  metadata: { userId: 'user_789' },
  timestamp: new Date('2024-01-15T14:30:45.123Z'),
  // ... other properties
};
```

**Location:**
- Database factories: `tests/fixtures/db.ts`
- Component test data: defined inline in test file (not reused across tests)
- Helper functions for API/session setup: `tests/integration/api/projects/server.integration.test.ts` (createRequestEvent, expectRedirect functions)

**Database Seeding Functions (from tests/fixtures/db.ts):**
- `seedProject()`: Insert single project with defaults
- `seedProjects()`: Insert multiple projects
- `seedLogs()`: Insert logs for a project
- `getOrCreateDefaultUser()`: Reusable user factory with caching (prevents duplicate test users)

## Coverage

**Requirements:**
- Target thresholds (enforced): 75% lines, 75% statements, 75% functions, 65% branches
- View coverage in HTML: `vitest.config.ts` lines 71-72 configure `lcov` reporter

**View Coverage:**
```bash
bun run test:coverage
# Creates coverage report in coverage/ directory
```

**Excluded from coverage:**
- shadcn-ui primitives (`src/lib/components/ui/**`)
- Type definitions and barrel exports
- E2E-tested routes and pages (tested via Playwright)
- Server hooks and error handlers (tested via integration tests)
- Routes: `src/routes/(app)/**`, `src/routes/login/**`

## Test Types

**Unit Tests:**
- Scope: Single function or class method
- Location: `src/**/*.unit.test.ts`
- Environment: Node.js
- Examples:
  - `src/lib/utils/format.unit.test.ts`: Pure functions (formatTimestamp, formatRelativeTime)
  - `src/lib/server/utils/api-key.unit.test.ts`: Format validation, key generation
  - `src/lib/server/config/env.unit.test.ts`: Configuration validation
- Approach: Test all valid inputs and edge cases (see format.unit.test.ts for comprehensive it.each() patterns)

**Integration Tests:**
- Scope: Multiple components working together (API routes, database operations, auth flows)
- Location: `tests/integration/**/*.integration.test.ts`
- Environment: Node.js with PGlite in-memory database
- Examples:
  - `tests/integration/api/projects/server.integration.test.ts`: GET/POST project endpoints with session auth
  - `tests/integration/auth/auth.integration.test.ts`: Sign up, sign in, session management
  - `tests/integration/db/project.integration.test.ts`: Database CRUD operations
- Approach:
  1. Create test database via `setupTestDatabase()`
  2. Create auth instance and test user via `auth.api.signUpEmail()`
  3. Call endpoint/function under test
  4. Assert database state changed correctly
  5. Cleanup via `cleanup()` function

**Component Tests:**
- Scope: Svelte component rendering and interactions
- Location: `src/**/__tests__/*.component.test.ts`
- Environment: jsdom (browser-like)
- Examples:
  - `src/lib/components/__tests__/log-card.component.test.ts`: Props, rendering, event handlers, CSS classes
  - `src/lib/components/__tests__/incident-table.component.test.ts`: Table rendering, interaction
- Approach:
  - Use `@testing-library/svelte` render() and query methods
  - Test user-visible behavior (rendered text, attributes) not implementation
  - Mock external utilities with `vi.mock()` for deterministic output
  - Test prop variations and event callbacks

**E2E Tests:**
- Framework: Playwright (`playwright.config.ts`)
- Location: `tests/e2e/**/*.spec.ts`
- Environment: Full browser (Chromium, Firefox)
- Examples:
  - `tests/e2e/auth-guard.spec.ts`: Login flow, redirect
  - `tests/e2e/dashboard.spec.ts`: Full dashboard rendering
  - `tests/e2e/live-stream.spec.ts`: Real-time log streaming
- Run command: `bun run test:e2e`
- CI behavior: Use preview build, 2 retries, 1 worker (playwright.config.ts lines 4-5, 31-34)

## Common Patterns

**Async Testing:**
```typescript
// Using async/await
it('should create user via signUpEmail', async () => {
  const result = await auth.api.signUpEmail({
    body: {
      email: 'test@example.com',
      password: 'SecureP@ssw0rd123',
      name: 'Test User',
    },
  });
  expect(result.user.email).toBe('test@example.com');
});

// Using Promise.then (rare in this codebase)
it('returns a promise', () => {
  return someAsyncFunction().then(result => {
    expect(result).toBeDefined();
  });
});
```

**Error Testing:**
```typescript
// Using expect().rejects for promise rejections
it('should fail to sign in with invalid password', async () => {
  await auth.api.signUpEmail({
    body: { email: 'test@example.com', password: 'SecureP@ssw0rd123', name: 'Test User' },
  });

  await expect(
    auth.api.signInEmail({
      body: { email: 'test@example.com', password: 'WrongPassword' },
    }),
  ).rejects.toThrow();
});

// Using helper function for expected exceptions
async function expectRedirect(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedLocation: string,
): Promise<void> {
  try {
    await promise;
    expect.fail('Expected redirect to be thrown');
  } catch (error) {
    const redirect = error as Redirect;
    expect(redirect.status).toBe(expectedStatus);
    expect(redirect.location).toBe(expectedLocation);
  }
}
```

**Database Integration Testing (tests/integration/api/projects/server.integration.test.ts pattern):**
```typescript
describe('GET /api/projects', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;

    // Create test user
    const signUpResult = await auth.api.signUpEmail({
      body: { email: 'test@example.com', password: 'SecureP@ssw0rd123', name: 'Test User' },
    });
    userId = signUpResult.user.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns all projects for authenticated user', async () => {
    // Setup
    const project1 = await seedProject(db, { ownerId: userId, name: 'Project 1' });
    const project2 = await seedProject(db, { ownerId: userId, name: 'Project 2' });

    // Execute
    const event = createRequestEvent(new Request('http://localhost:5173/api/projects'), db, authenticatedLocals);
    const response = await GET(event as RequestEvent);

    // Assert
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Project 1');
  });
});
```

**Component Testing Pattern (src/lib/components/__tests__/log-card.component.test.ts):**
```typescript
describe('LogCard', () => {
  const baseLog: Log = { /* test data */ };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('applies log-new class when isNew is true', () => {
    render(LogCard, { props: { log: baseLog, isNew: true } });

    const card = screen.getByTestId('log-card');
    expect(card).toHaveClass('log-new');
  });

  it('calls onclick when card is clicked', async () => {
    const onclick = vi.fn();
    render(LogCard, { props: { log: baseLog, onclick } });

    const card = screen.getByTestId('log-card');
    await fireEvent.click(card);

    expect(onclick).toHaveBeenCalledTimes(1);
    expect(onclick).toHaveBeenCalledWith(baseLog);
  });
});
```

## Test Database Setup

**PGlite In-Memory (src/lib/server/db/test-db.ts):**
- Used for all integration tests (no external PostgreSQL required)
- Creates temporary in-memory database per test
- Dynamically generates CREATE TABLE SQL from Drizzle schema
- Handles foreign keys, indexes, enums, and triggers
- Cleanup via `cleanDatabase()` truncates all tables

**Session/Auth Testing:**
- Create auth instance: `const auth = createAuth(db)`
- Sign up test user: `await auth.api.signUpEmail({ body: { email, password, name } })`
- Extract session token from result
- Reuse for authenticated requests

---

*Testing analysis: 2026-02-26*
