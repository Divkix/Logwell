import { LogwellError } from "./errors";
import type { LogwellConfig } from "./types";

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  batchSize: 50,
  flushInterval: 5000,
  maxQueueSize: 1000,
  maxRetries: 3,
  timeout: 30000,
  captureSourceLocation: false,
} as const;

/**
 * Resolved configuration with all defaults applied and required fields guaranteed
 */
export interface ResolvedConfig {
  apiKey: string;
  endpoint: string;
  service?: string;
  batchSize: number;
  flushInterval: number;
  maxQueueSize: number;
  maxRetries: number;
  timeout: number;
  captureSourceLocation: boolean;
  onError?: (error: Error) => void;
  onFlush?: (count: number) => void;
}

/**
 * API key format regex: lw_[32 alphanumeric chars including - and _]
 */
export const API_KEY_REGEX = /^lw_[A-Za-z0-9_-]{32}$/;

/**
 * Validates API key format
 *
 * @param apiKey - API key to validate
 * @returns true if valid format, false otherwise
 */
export function validateApiKeyFormat(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== "string") {
    return false;
  }
  return API_KEY_REGEX.test(apiKey);
}

/**
 * Validates a URL string, requiring http or https protocol
 *
 * @param url - URL string to validate
 * @throws LogwellError if the URL is invalid or uses a non-http/https scheme
 */
function validateEndpointUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LogwellError("Invalid endpoint URL", "INVALID_CONFIG");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new LogwellError("endpoint must use http or https", "INVALID_CONFIG");
  }
}

/**
 * Validates configuration and returns merged config with defaults
 *
 * @param config - Partial configuration to validate
 * @returns Complete configuration with all defaults applied
 * @throws LogwellError if configuration is invalid
 */
export function validateConfig(config: Partial<LogwellConfig>): ResolvedConfig {
  // Validate required fields
  if (!config.apiKey) {
    throw new LogwellError("apiKey is required", "INVALID_CONFIG");
  }

  if (!config.endpoint) {
    throw new LogwellError("endpoint is required", "INVALID_CONFIG");
  }

  // Validate API key format
  if (!validateApiKeyFormat(config.apiKey)) {
    throw new LogwellError(
      "Invalid API key format. Expected: lw_[32 characters]",
      "INVALID_CONFIG",
    );
  }

  // Validate endpoint URL (also checks protocol)
  validateEndpointUrl(config.endpoint);

  // Validate numeric options — lower bounds
  if (config.batchSize !== undefined && config.batchSize <= 0) {
    throw new LogwellError("batchSize must be positive", "INVALID_CONFIG");
  }

  if (config.flushInterval !== undefined && config.flushInterval <= 0) {
    throw new LogwellError("flushInterval must be positive", "INVALID_CONFIG");
  }

  if (config.maxQueueSize !== undefined && config.maxQueueSize <= 0) {
    throw new LogwellError("maxQueueSize must be positive", "INVALID_CONFIG");
  }

  if (config.maxRetries !== undefined && config.maxRetries < 0) {
    throw new LogwellError("maxRetries must be non-negative", "INVALID_CONFIG");
  }

  if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) {
    throw new LogwellError("timeout must be a positive finite number", "INVALID_CONFIG");
  }

  // Validate numeric options — upper bounds (TS-7)
  if (config.batchSize !== undefined && config.batchSize > 100) {
    throw new LogwellError("batchSize cannot exceed 100 (server limit)", "INVALID_CONFIG");
  }

  if (config.maxQueueSize !== undefined && config.maxQueueSize > 100000) {
    throw new LogwellError("maxQueueSize cannot exceed 100000", "INVALID_CONFIG");
  }

  if (config.flushInterval !== undefined && config.flushInterval < 100) {
    throw new LogwellError("flushInterval must be at least 100ms", "INVALID_CONFIG");
  }

  if (config.flushInterval !== undefined && config.flushInterval > 60000) {
    throw new LogwellError("flushInterval cannot exceed 60000ms", "INVALID_CONFIG");
  }

  // Normalize endpoint: strip trailing slash
  const endpoint = config.endpoint.replace(/\/$/, "");

  // Return merged config with all defaults — typed as ResolvedConfig (no cast needed)
  return {
    apiKey: config.apiKey,
    endpoint,
    service: config.service,
    batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
    flushInterval: config.flushInterval ?? DEFAULT_CONFIG.flushInterval,
    maxQueueSize: config.maxQueueSize ?? DEFAULT_CONFIG.maxQueueSize,
    maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
    timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    captureSourceLocation: config.captureSourceLocation ?? DEFAULT_CONFIG.captureSourceLocation,
    onError: config.onError,
    onFlush: config.onFlush,
  };
}
