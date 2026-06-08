import '@testing-library/jest-dom/vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/svelte';
import { afterEach, expect } from 'vitest';

// Ensure DATABASE_URL is set for tests (PGlite doesn't need real connection)
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
}

// Ensure BETTER_AUTH_SECRET is set for tests
if (!process.env.BETTER_AUTH_SECRET) {
  process.env.BETTER_AUTH_SECRET = 'test-secret-key-at-least-32-chars';
}

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Global cleanup after each test
afterEach(() => {
  cleanup();
});
