/**
 * Environment Configuration Module
 *
 * Centralizes all environment variable access with validation.
 * Validates required variables at module load time and provides
 * type-safe access to configuration values.
 *
 * Required Variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - BETTER_AUTH_SECRET: 32+ character secret for auth sessions (required in production)
 *
 * Optional Variables:
 * - ADMIN_PASSWORD: Password for seeding admin user
 * - ORIGIN: Base URL for production (CORS/trusted origins)
 * - RATE_LIMIT_INGEST_IP_RPM: Pre-auth /v1 requests per minute per client IP (default 60000)
 * - DB_STATEMENT_TIMEOUT_MS: Postgres statement_timeout for the app pool (default 30000, 0 = off)
 * - DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: Postgres idle_in_transaction_session_timeout
 *   for the app pool (default 60000, 0 = off)
 * - NODE_ENV: Environment mode (development/production)
 */

import { z } from "zod";
import { parseEnvInt } from "./performance";

/**
 * Environment variable validation error
 */
export class EnvValidationError extends Error {
  constructor(
    message: string,
    public readonly variable: string,
  ) {
    super(message);
    this.name = "EnvValidationError";
  }
}

// Get NODE_ENV first for conditional validation. Read through `globalThis` on purpose:
// bundlers statically replace `process.env.NODE_ENV` with the build-time mode ("development"
// for the SSR bundle), which would make a production server report development - skipping
// secret validation and issuing non-Secure session cookies.
const nodeEnv = globalThis.process?.env?.NODE_ENV ?? "production";

const isDevExplicit = nodeEnv === "development" || nodeEnv === "test";

// Collect validation errors
const validationErrors: Array<{ variable: string; message: string }> = [];

// Validate DATABASE_URL
const rawDatabaseUrl = process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  validationErrors.push({
    variable: "DATABASE_URL",
    message: "DATABASE_URL environment variable is required",
  });
} else if (!rawDatabaseUrl.startsWith("postgres")) {
  validationErrors.push({
    variable: "DATABASE_URL",
    message:
      "DATABASE_URL must be a PostgreSQL connection string (starts with postgres:// or postgresql://)",
  });
}

// Re-read after validation to get narrowed type (validation throws if missing)
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url) throw new Error("DATABASE_URL missing after validation");

  return url;
}

// Validate BETTER_AUTH_SECRET
const authSecret = process.env.BETTER_AUTH_SECRET;

if (!isDevExplicit) {
  if (!authSecret) {
    validationErrors.push({
      variable: "BETTER_AUTH_SECRET",
      message: "BETTER_AUTH_SECRET is required unless NODE_ENV=development",
    });
  } else if (authSecret.length < 32) {
    validationErrors.push({
      variable: "BETTER_AUTH_SECRET",
      message: "BETTER_AUTH_SECRET must be at least 32 characters long",
    });
  }
}

// Validate ORIGIN: the CSRF guard parses it on every mutation, so a typo fails here instead.
const rawOrigin = process.env.ORIGIN;

if (rawOrigin && !URL.canParse(rawOrigin)) {
  validationErrors.push({
    variable: "ORIGIN",
    message: "ORIGIN must be an absolute URL such as https://logs.example.com",
  });
}

// Postgres-side query limits for the app pool. Unlike the tuning knobs in performance.ts these
// fail startup on a bad value: a typo silently falling back would leave runaway statements
// uncancelled (or cancel healthy ones) with nothing in the logs to say why.
const DB_TIMEOUT_DEFAULTS = {
  DB_STATEMENT_TIMEOUT_MS: 30_000,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 60_000,
} as const;

// Whole milliseconds, 0 = disabled (Postgres semantics), at most one hour.
const dbTimeoutMsSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "must be a whole number of milliseconds")
  .transform(Number)
  .pipe(z.number().max(3_600_000, "must be at most 3600000 (1 hour)"));

function parseDbTimeout(key: keyof typeof DB_TIMEOUT_DEFAULTS): number {
  const raw = process.env[key];

  if (raw === undefined || raw.trim() === "") return DB_TIMEOUT_DEFAULTS[key];

  const parsed = dbTimeoutMsSchema.safeParse(raw);

  if (parsed.success) return parsed.data;

  validationErrors.push({
    variable: key,
    message: `${key} ${parsed.error.issues[0]?.message ?? "is invalid"} (0 disables it)`,
  });

  return DB_TIMEOUT_DEFAULTS[key];
}

const dbStatementTimeoutMs = parseDbTimeout("DB_STATEMENT_TIMEOUT_MS");

const dbIdleInTransactionTimeoutMs = parseDbTimeout("DB_IDLE_IN_TRANSACTION_TIMEOUT_MS");

// Throw aggregated error if validation failed
if (validationErrors.length > 0) {
  const errorMessages = validationErrors.map((e) => `- ${e.variable}: ${e.message}`).join("\n");
  const firstError = validationErrors[0];
  throw new EnvValidationError(
    `Environment validation failed:\n${errorMessages}`,
    firstError?.variable ?? "unknown",
  );
}

// Pre-auth per-IP throttle for /v1 (see hooks.server.ts). parseEnvInt already falls back to
// the default for unparsable values; the extra guard keeps an explicit 0 from becoming a
// hard block for every client behind one NAT.
const DEFAULT_INGEST_IP_RPM = 60000;

const ingestIpRpm = parseEnvInt("RATE_LIMIT_INGEST_IP_RPM", DEFAULT_INGEST_IP_RPM);

/**
 * Validated environment configuration
 */
export const env = {
  /** PostgreSQL connection string */
  DATABASE_URL: getDatabaseUrl(),

  /** Secret key for better-auth sessions (defaults to dev secret in explicit development) */
  BETTER_AUTH_SECRET: authSecret ?? (isDevExplicit ? "default-secret-for-development-only" : ""),

  /** Password for seeding admin user (optional) */
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,

  /** Base URL for production deployment (optional; the CSRF check falls back to the request Host when unset) */
  ORIGIN: process.env.ORIGIN,

  /** Pre-auth /v1 requests per minute per client IP, checked before API-key validation */
  RATE_LIMIT_INGEST_IP_RPM: ingestIpRpm > 0 ? ingestIpRpm : DEFAULT_INGEST_IP_RPM,

  /** Postgres statement_timeout (ms) for every app-pool connection; 0 = server default */
  DB_STATEMENT_TIMEOUT_MS: dbStatementTimeoutMs,

  /** Postgres idle_in_transaction_session_timeout (ms) for the app pool; 0 = server default */
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: dbIdleInTransactionTimeoutMs,

  /** Current environment mode */
  NODE_ENV: nodeEnv,
} as const;

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return env.NODE_ENV !== "production";
}
