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

// Get NODE_ENV first for conditional validation
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// Collect validation errors
const validationErrors: Array<{ variable: string; message: string }> = [];

// Validate DATABASE_URL
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  validationErrors.push({
    variable: 'DATABASE_URL',
    message: 'DATABASE_URL environment variable is required',
  });
} else if (!databaseUrl.startsWith('postgres')) {
  validationErrors.push({
    variable: 'DATABASE_URL',
    message: 'DATABASE_URL must be a PostgreSQL connection string (starts with postgres:// or postgresql://)',
  });
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
  throw new EnvValidationError(
    `Environment validation failed:\n${errorMessages}`,
    validationErrors[0].variable,
  );
}

/**
 * Validated environment configuration
 */
export const env = {
  /** PostgreSQL connection string */
  DATABASE_URL: databaseUrl!,

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
 * Validate environment configuration
 * Returns validation result instead of throwing
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

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Mask a sensitive value for logging
 */
function maskValue(value: string | undefined, maskChar = '*'): string {
  if (!value) return '[not set]';
  return maskChar.repeat(Math.min(value.length, 16));
}

/**
 * Mask a database URL (hide password)
 */
function maskDatabaseUrl(url: string | undefined): string {
  if (!url) return '[not set]';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, just mask the whole thing
    return maskValue(url);
  }
}

/**
 * Get a summary of environment configuration with masked sensitive values
 * Useful for logging/debugging without exposing secrets
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
