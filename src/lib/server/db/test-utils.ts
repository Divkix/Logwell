/**
 * Test utilities for database testing
 *
 * This file re-exports from test-db.ts and provides backward compatibility
 * for existing tests. New tests should import directly from test-db.ts or
 * from fixtures/db.ts for seeding helpers.
 */

export { cleanDatabase, createTestDatabase, setupTestDatabase } from "./test-db";
