import { LogwellError } from './errors';
import type { LogwellConfig } from './types';

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  batchSize: 50,
  flushInterval: 5000,
  maxQueueSize: 1000,
  maxRetries: 3,
  captureSourceLocation: false,
} as const;

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
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }
  return API_KEY_REGEX.test(apiKey);
}

/**
 * Validates a URL string
 *
 * @param url - URL string to validate
 * @returns true if valid URL, false otherwise
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates configuration and returns merged config with defaults
 *
 * @param config - Partial configuration to validate
 * @returns Complete configuration with defaults applied
 * @throws LogwellError if configuration is invalid
 */
export function validateConfig(config: Partial<LogwellConfig>): LogwellConfig {
  // Validate required fields
  if (!config.apiKey) {
    throw new LogwellError('apiKey is required', 'INVALID_CONFIG');
  }

  if (!config.endpoint) {
    throw new LogwellError('endpoint is required', 'INVALID_CONFIG');
  }

  // Validate API key format
  if (!validateApiKeyFormat(config.apiKey)) {
    throw new LogwellError(
      'Invalid API key format. Expected: lw_[32 characters]',
      'INVALID_CONFIG',
    );
  }

  // Validate endpoint URL
  if (!isValidUrl(config.endpoint)) {
    throw new LogwellError('Invalid endpoint URL', 'INVALID_CONFIG');
  }

  // Validate numeric options
  if (config.batchSize !== undefined && config.batchSize <= 0) {
    throw new LogwellError('batchSize must be positive', 'INVALID_CONFIG');
  }

  if (config.flushInterval !== undefined && config.flushInterval <= 0) {
    throw new LogwellError('flushInterval must be positive', 'INVALID_CONFIG');
  }

  if (config.maxQueueSize !== undefined && config.maxQueueSize <= 0) {
    throw new LogwellError('maxQueueSize must be positive', 'INVALID_CONFIG');
  }

  if (config.maxRetries !== undefined && config.maxRetries < 0) {
    throw new LogwellError('maxRetries must be non-negative', 'INVALID_CONFIG');
  }

  // Return merged config with defaults
  return {
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    service: config.service,
    batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
    flushInterval: config.flushInterval ?? DEFAULT_CONFIG.flushInterval,
    maxQueueSize: config.maxQueueSize ?? DEFAULT_CONFIG.maxQueueSize,
    maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
    captureSourceLocation: config.captureSourceLocation ?? DEFAULT_CONFIG.captureSourceLocation,
    onError: config.onError,
    onFlush: config.onFlush,
  };
}
