/**
 * Server Configuration Module
 *
 * Centralizes all server-side configuration including:
 * - Environment variables with validation
 * - Performance tuning parameters
 *
 * Usage:
 * ```ts
 * import { env, isProduction, SSE_CONFIG } from '$lib/server/config';
 * ```
 */

export {
  type EnvSummary,
  EnvValidationError,
  env,
  getEnvSummary,
  isDevelopment,
  isProduction,
  type ValidationResult,
  validateEnv,
} from './env';

export {
  API_CONFIG,
  INCIDENT_CONFIG,
  LOG_STREAM_CONFIG,
  RETENTION_CONFIG,
  SSE_CONFIG,
  type SSEConfigType,
  validateSSEConfig,
} from './performance';
