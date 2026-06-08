# Test Fixtures

This directory contains test fixtures and factory functions for seeding test data.

## Database Fixtures (`db.ts`)

Provides helper functions for creating and seeding test data in PGlite test databases.

### Factory Functions

#### `createUserFactory(overrides?)`

Creates a user object with default values that can be overridden.

```typescript
import { createUserFactory } from "../fixtures/db";

// Default values
const user = createUserFactory(); // { age: 25 }

// With overrides
const customUser = createUserFactory({ age: 30 }); // { age: 30 }
```

### Seeding Functions

#### `seedUser(db, overrides?)`

Seeds a single user into the database.

```typescript
import { setupTestDatabase } from "../../src/lib/server/db/test-db";
import { seedUser } from "../fixtures/db";

const { db, cleanup } = await setupTestDatabase();
const user = await seedUser(db, { age: 35 });
```

#### `seedUsers(db, count?, overrides?)`

Seeds multiple users with auto-incrementing ages (default: 3 users starting at age 20).

```typescript
import { seedUsers } from "../fixtures/db";

// Default: 3 users with ages 20, 25, 30
const users = await seedUsers(db);

// Custom count: 5 users
const manyUsers = await seedUsers(db, 5);

// With overrides: All users will have age 40
const customUsers = await seedUsers(db, 2, { age: 40 });
```

#### `seedUsersWithAges(db, ages[])`

Seeds users with specific ages.

```typescript
import { seedUsersWithAges } from "../fixtures/db";

const users = await seedUsersWithAges(db, [18, 25, 30, 45, 60]);
// Creates 5 users with exactly these ages
```

#### `seedTestData(db, data)`

Generic seeder that accepts a data object with optional arrays for each table.

```typescript
import { seedTestData } from "../fixtures/db";

await seedTestData(db, {
  users: [{ age: 20 }, { age: 30 }, { age: 40 }],
});
```

## Usage in Tests

```typescript
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../src/lib/server/db/test-db";
import { seedUser, seedUsers } from "../fixtures/db";

describe("My Test Suite", () => {
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

  it("should work with pre-seeded data", async () => {
    // Seed test data
    const user = await seedUser(db, { age: 25 });

    // Run your test
    expect(user.age).toBe(25);
  });
});
```

## Type Exports

- `UserInsert` - Type for inserting a user (inferred from schema)
- `UserSelect` - Type for a selected user from database (inferred from schema)

```typescript
import type { UserInsert, UserSelect } from "../fixtures/db";

const insert: UserInsert = { age: 25 };
const selected: UserSelect = { id: 1, age: 25 };
```

## Extending for New Tables

When adding new tables to the schema, extend the fixtures:

1. Add type exports for the new table
2. Create a factory function
3. Create seeding functions
4. Update `seedTestData` to support the new table

Example:

```typescript
// For a new "posts" table
export type PostInsert = typeof schema.posts.$inferInsert;
export type PostSelect = typeof schema.posts.$inferSelect;

export function createPostFactory(overrides: Partial<PostInsert> = {}): PostInsert {
  return {
    title: "Default Title",
    content: "Default content",
    ...overrides,
  };
}

export async function seedPost(
  db: PgliteDatabase<typeof schema>,
  overrides: Partial<PostInsert> = {},
): Promise<PostSelect> {
  const post = createPostFactory(overrides);
  const [result] = await db.insert(schema.posts).values(post).returning();
  return result;
}
```
