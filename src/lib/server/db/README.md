# Database Layer

This directory contains the database schema, client initialization, and test utilities.

## Files

### `schema.ts`

Drizzle ORM table definitions for the application.

```typescript
import * as schema from "./schema";

// Access tables
const users = schema.user;
```

### `index.ts`

Production database client initialization using postgres.js.

```typescript
import { db } from "./index";

// Use in production/development
const users = await db.select().from(schema.user);
```

### `test-db.ts`

In-memory PGlite database for testing. **Do not use in production.**

#### Key Features

- **In-memory PostgreSQL**: Uses PGlite for fast, isolated tests
- **Dynamic Schema Application**: Automatically creates all tables from Drizzle schema
- **No Hardcoding**: Works with any schema without manual updates
- **Cleanup Utilities**: Efficiently truncates all tables between tests

#### API

##### `createTestDatabase()`

Creates a new in-memory PGlite database with all schema tables.

```typescript
import { createTestDatabase } from "./test-db";

const db = await createTestDatabase();
// All schema tables are created automatically
```

##### `cleanDatabase(db)`

Truncates all tables and restarts identity sequences.

```typescript
import { cleanDatabase } from "./test-db";

await cleanDatabase(db);
// All tables are now empty, sequences reset to 1
```

##### `setupTestDatabase()`

Convenience function that creates a database and returns it with a cleanup function.

```typescript
import { setupTestDatabase } from "./test-db";

const { db, cleanup } = await setupTestDatabase();

// Use db for testing

await cleanup(); // Truncates all tables
```

#### Usage in Tests

```typescript
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, it } from "vite-plus/test";
import { seedProject } from "../../../../tests/fixtures/db";
import * as schema from "./schema";
import { setupTestDatabase } from "./test-db";

describe("Database Tests", () => {
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

  it("should work with database", async () => {
    const project = await seedProject(db, { name: "my-project" });
    // Test assertions...
  });
});
```

## Database Schema Updates

When adding new tables to `schema.ts`:

1. **No changes needed to test-db.ts** - it automatically detects and creates all tables
2. **Update fixtures** - add factory functions in `/tests/fixtures/db.ts`
3. **Tests keep working** - existing tests continue to function without modification

Example:

```typescript
// schema.ts
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
});

// test-db.ts automatically creates the "posts" table
// No manual changes needed!
```

## Dynamic Schema Generation

The `test-db.ts` module uses Drizzle's `getTableConfig()` to dynamically generate CREATE TABLE SQL for all tables in the schema. This means:

- **No hardcoded table names**
- **Supports most Drizzle column types**
- **Automatically handles constraints** (PRIMARY KEY, NOT NULL, DEFAULT)
- **Works with future schema additions**

### Supported Column Types

- `serial` / `integer` → `SERIAL` / `INTEGER`
- `text` / `varchar` → `TEXT` / `VARCHAR`
- `boolean` → `BOOLEAN`
- `timestamp` / `date` → `TIMESTAMP`
- `jsonb` → `JSONB`

For complex schemas with relationships, custom types, or advanced constraints, consider using Drizzle Kit migrations instead.

## Performance Notes

- **PGlite is in-memory**: Tests are fast (no network, no disk I/O)
- **Each test gets isolated database**: Parallel tests don't interfere
- **TRUNCATE is efficient**: Much faster than DROP/CREATE between tests
- **Startup overhead**: ~400-800ms for first database creation

## Migration Strategy

For production migrations, use Drizzle Kit:

```bash
# Generate migration files
bun run db:generate

# Apply migrations
bun run db:migrate
```

For tests, use the dynamic schema application from `test-db.ts` - no migrations needed.
