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
 * - NODE_ENV: Environment mode (development/production)
 */

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

// Get NODE_ENV first for conditional validation
const nodeEnv = process.env.NODE_ENV || "development";
const isDevExplicit = nodeEnv === "development";

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

// Throw aggregated error if validation failed
if (validationErrors.length > 0) {
  const errorMessages = validationErrors.map((e) => `- ${e.variable}: ${e.message}`).join("\n");
  const firstError = validationErrors[0];
  throw new EnvValidationError(
    `Environment validation failed:\n${errorMessages}`,
    firstError?.variable ?? "unknown",
  );
}

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

  /** Base URL for production deployment (optional) */
  ORIGIN: process.env.ORIGIN,

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
