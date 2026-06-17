/**
 * Server Configuration Module
 *
 * Centralizes all server-side configuration including:
 * - Environment variables with validation
 * - Performance tuning parameters
 *
 * Usage:
 * ```ts
 * import { env, RETENTION_CONFIG } from '$lib/server/config';
 * ```
 */

export { env } from "./env";

export { INCIDENT_CONFIG, RETENTION_CONFIG } from "./performance";
