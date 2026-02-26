# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- Source files: camelCase (`src/lib/utils/format.ts`, `src/lib/hooks/use-log-stream.svelte.ts`)
- Svelte components: PascalCase (`LogCard.svelte`, `LevelBadge.svelte`)
- Test files: descriptive with type suffix (`api-key.unit.test.ts`, `log-card.component.test.ts`, `server.integration.test.ts`)
- Directories: kebab-case (`src/lib/server/utils/`, `tests/integration/`)
- Schema/database files: camelCase (`src/lib/server/db/schema.ts`)

**Functions:**
- camelCase for all function names (`generateApiKey()`, `validateApiKeyFormat()`, `formatTimestamp()`)
- Exported utility functions are descriptive (`getOrCreateDefaultUser()`, `createLogFactory()`)
- Private/internal functions use same convention as public ones

**Variables:**
- camelCase for all local and global variables (`apiKey`, `projectId`, `defaultUserCache`)
- Constants: UPPER_SNAKE_CASE (`API_KEY_CACHE`, `CACHE_TTL_MS`, `API_KEY_REGEX`)
- Boolean variables: prefixed with `is` or `has` (`isNew`, `isSelected`, `hasDefault`)

**Types:**
- PascalCase for all TypeScript types and interfaces (`CacheEntry`, `UseLogStreamOptions`, `UseLogStreamReturn`)
- Generic type variables: single letter or descriptive (`T`, `TData`)
- Union/discriminated types follow domain naming (`LogLevel`, `ProjectInsert`, `UserSelect`)
- Database inferred types use `$infer*` pattern (`Project = typeof project.$inferSelect`, `NewProject = typeof project.$inferInsert`)

## Code Style

**Formatting:**
- Tool: Biome 2.4.4
- Indentation: 2 spaces (enforced in biome.json)
- Line width: 100 characters (enforced)
- Trailing commas: always in JavaScript/TypeScript (for cleaner diffs)
- Quotes: single quotes
- Semicolons: always

**Linting:**
- Tool: Biome (biome.json)
- Recommended rules enabled
- Key enforcement:
  - `noUnusedImports`: error
  - `noUnusedVariables`: error
  - `useExhaustiveDependencies`: warn
  - `noNonNullAssertion`: warn
  - `useConst`: error (prefer const over let)
  - `useImportType`: error (use `import type` for types)
  - `noExplicitAny`: warn

**Svelte-specific overrides:**
- `noUnusedImports` and `noUnusedVariables` are OFF for .svelte files (Svelte 5 runes are reactive)
- `useConst` and `useImportType` are OFF for .svelte files

## Import Organization

**Order:**
1. Node.js/built-in imports (`import path from 'node:path'`)
2. External third-party packages (`import { describe, it } from 'vitest'`, `import { drizzle } from 'drizzle-orm'`)
3. Internal app imports (`import { setupTestDatabase } from '$lib/server/db/test-db'`)
4. Relative imports (rare, mostly avoided in favor of $lib alias)

**Path Aliases:**
- `$lib` → `src/lib` (primary alias for shared code)
- `$app` → SvelteKit built-in for app-related modules
- No other custom aliases - always use $lib

**Auto-formatting:**
- Biome's `assist.actions.source.organizeImports` is enabled
- Imports are automatically organized on save/format

## Error Handling

**Patterns:**
- Custom error classes for domain-specific errors (e.g., `ApiKeyError` in `src/lib/server/utils/api-key.ts`)
- Error classes extend `Error` and include status codes for HTTP contexts
- Try-catch blocks wrap database operations, file I/O, and external API calls
- Database operations in test utilities use try-catch with console.warn fallback (see `src/lib/server/db/test-db.ts` lines 149-180, 234-246)
- Validation errors throw custom error instances with appropriate HTTP status codes
- Global error handler defined in `src/lib/server/error-handler.ts` and used in `src/hooks.server.ts`

**Error Throwing:**
- Custom errors include both `status` and `body.message` for API responses
- Example: `throw new ApiKeyError(401, 'Invalid API key format')` (line 105 in `src/lib/server/utils/api-key.ts`)

## Logging

**Framework:** console (no external logger, using native console methods)

**Patterns:**
- `console.warn()` for non-critical issues and fallback cases (database setup warnings)
- Structured logging is not enforced; messages are human-readable strings
- No debug-level logging; warnings are primary

## Comments

**When to Comment:**
- Explain WHY, not WHAT. Code is self-documenting for obvious logic.
- Comment complex algorithm explanations (e.g., cache invalidation logic)
- Document important architectural decisions or workarounds
- Comment edge cases and boundary conditions

**JSDoc/TSDoc:**
- Always include JSDoc for exported functions (see `src/lib/utils/format.ts` for examples)
- Include `@param` and `@returns` tags for all exported functions
- Include `@example` blocks for public APIs (see lines 8-14 in `src/lib/utils/format.ts`)
- Comment error conditions with `@throws` tag (see line 88 in `src/lib/server/utils/api-key.ts`)
- Multi-line comment blocks use `/** ... */` format

**Example from codebase:**
```typescript
/**
 * Validates API key format using regex pattern
 * Does not check if key exists in database
 *
 * @param key - API key to validate
 * @returns true if key matches format, false otherwise
 */
export function validateApiKeyFormat(key: string): boolean {
  // ...
}
```

## Function Design

**Size:** Functions should be focused and typically under 50 lines for readability. Complex operations (like schema generation in `src/lib/server/db/test-db.ts`) are split into smaller helper functions.

**Parameters:**
- Prefer explicit parameters over boolean flags
- Use object parameters for functions with multiple optional parameters
- Type all parameters strictly (strict TypeScript mode enforced in tsconfig.json)
- Optional parameters use `?:` syntax or function overloads

**Return Values:**
- Always include explicit return types in function signatures
- Async functions return Promises with explicit typing
- Functions that query databases typically return `Promise<T[]>` or `Promise<T | undefined>`
- Utility functions with multiple return paths document all cases in JSDoc

**Example from codebase (from `api-key.ts`):**
```typescript
export async function validateApiKey(
  request: Request,
  dbClient?: PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>,
): Promise<string> {
  // ...
  return result.id;
}
```

## Module Design

**Exports:**
- Prefer named exports over default exports (enforced via convention, no default exports in codebase)
- Type exports always use `export type` syntax (required by biome `useImportType: error`)
- Re-export common types from schema: `export type Project = typeof project.$inferSelect`

**Barrel Files:**
- `src/lib/index.ts` exists as central export (lines show type definitions only)
- No circular dependencies; imports follow dependency hierarchy (UI layers depend on server/utils layers)

**Internal vs. Public:**
- `src/lib/server/` is private/backend-only
- `src/lib/` (except server) is shared between server and client
- Test utilities are in `tests/fixtures/` and `src/lib/server/db/test-utils.ts`

## Code Examples from Codebase

**API Key Validation with Caching (src/lib/server/utils/api-key.ts, lines 90-135):**
```typescript
export async function validateApiKey(
  request: Request,
  dbClient?: PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>,
): Promise<string> {
  // Extract Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiKeyError(401, 'Missing or invalid authorization header');
  }

  // Extract API key from Bearer token
  const apiKey = authHeader.substring(7);

  // Validate format first (fast fail)
  if (!validateApiKeyFormat(apiKey)) {
    throw new ApiKeyError(401, 'Invalid API key format');
  }

  // Check cache
  const cached = API_KEY_CACHE.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId;
  }

  // Query database and update cache
  // ...
}
```

**Timestamp Formatting with Multiple Formats (src/lib/utils/format.ts, lines 12-19):**
```typescript
export function formatTimestamp(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');

  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}
```

**Database Operations with Try-Catch (src/lib/server/db/test-db.ts, lines 149-180):**
```typescript
try {
  // Call reference() to get the foreign key details
  const ref = (fk as { reference: () => unknown }).reference();
  // ... process foreign key
} catch (error) {
  console.warn('Could not process foreign key:', error);
}
```

---

*Convention analysis: 2026-02-26*
