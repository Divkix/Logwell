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
  env,
  isProduction,
  isDevelopment,
  validateEnv,
  getEnvSummary,
  EnvValidationError,
  type ValidationResult,
  type EnvSummary,
} from './env';

export {
  SSE_CONFIG,
  LOG_STREAM_CONFIG,
  API_CONFIG,
  validateSSEConfig,
  type SSEConfigType,
} from './performance';
