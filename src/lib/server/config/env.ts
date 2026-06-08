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
    this.name = 'EnvValidationError';
  }
}

// Get NODE_ENV first for conditional validation
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// Collect validation errors
const validationErrors: Array<{ variable: string; message: string }> = [];

// Validate DATABASE_URL
const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl) {
  validationErrors.push({
    variable: 'DATABASE_URL',
    message: 'DATABASE_URL environment variable is required',
  });
} else if (!rawDatabaseUrl.startsWith('postgres')) {
  validationErrors.push({
    variable: 'DATABASE_URL',
    message:
      'DATABASE_URL must be a PostgreSQL connection string (starts with postgres:// or postgresql://)',
  });
}

// Re-read after validation to get narrowed type (validation throws if missing)
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing after validation');
  return url;
}

// Validate BETTER_AUTH_SECRET
const authSecret = process.env.BETTER_AUTH_SECRET;
if (isProd) {
  if (!authSecret) {
    validationErrors.push({
      variable: 'BETTER_AUTH_SECRET',
      message: 'BETTER_AUTH_SECRET environment variable is required in production',
    });
  } else if (authSecret.length < 32) {
    validationErrors.push({
      variable: 'BETTER_AUTH_SECRET',
      message: 'BETTER_AUTH_SECRET must be at least 32 characters long',
    });
  }
}

// Throw aggregated error if validation failed
if (validationErrors.length > 0) {
  const errorMessages = validationErrors.map((e) => `- ${e.variable}: ${e.message}`).join('\n');
  const firstError = validationErrors[0];
  throw new EnvValidationError(
    `Environment validation failed:\n${errorMessages}`,
    firstError?.variable ?? 'unknown',
  );
}

/**
 * Validated environment configuration
 */
export const env = {
  /** PostgreSQL connection string */
  DATABASE_URL: getDatabaseUrl(),

  /** Secret key for better-auth sessions (defaults to dev secret in development) */
  BETTER_AUTH_SECRET: authSecret || 'default-secret-for-development-only',

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
  return env.NODE_ENV === 'production';
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return env.NODE_ENV !== 'production';
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{ variable: string; message: string }>;
}

/**
 * Environment summary type (with masked sensitive values)
 */
export interface EnvSummary {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  ADMIN_PASSWORD: string;
  ORIGIN: string;
  NODE_ENV: string;
}

/**
 * Validate environment configuration — returns result instead of throwing.
 * Used in tests and diagnostics.
 */
export function validateEnv(): ValidationResult {
  const errors: Array<{ variable: string; message: string }> = [];

  if (!process.env.DATABASE_URL) {
    errors.push({
      variable: 'DATABASE_URL',
      message: 'DATABASE_URL environment variable is required',
    });
  } else if (!process.env.DATABASE_URL.startsWith('postgres')) {
    errors.push({
      variable: 'DATABASE_URL',
      message: 'DATABASE_URL must be a PostgreSQL connection string',
    });
  }

  if (isProduction()) {
    if (!process.env.BETTER_AUTH_SECRET) {
      errors.push({
        variable: 'BETTER_AUTH_SECRET',
        message: 'BETTER_AUTH_SECRET is required in production',
      });
    } else if (process.env.BETTER_AUTH_SECRET.length < 32) {
      errors.push({
        variable: 'BETTER_AUTH_SECRET',
        message: 'BETTER_AUTH_SECRET must be at least 32 characters',
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function maskValue(value: string | undefined): string {
  if (!value) return '[not set]';
  return '*'.repeat(Math.min(value.length, 16));
}

function maskDatabaseUrl(url: string | undefined): string {
  if (!url) return '[not set]';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return maskValue(url);
  }
}

/**
 * Get a summary of environment configuration with masked sensitive values.
 * Used in tests and diagnostics.
 */
export function getEnvSummary(): EnvSummary {
  return {
    DATABASE_URL: maskDatabaseUrl(process.env.DATABASE_URL),
    BETTER_AUTH_SECRET: maskValue(process.env.BETTER_AUTH_SECRET),
    ADMIN_PASSWORD: maskValue(process.env.ADMIN_PASSWORD),
    ORIGIN: process.env.ORIGIN || '[not set]',
    NODE_ENV: env.NODE_ENV,
  };
}
