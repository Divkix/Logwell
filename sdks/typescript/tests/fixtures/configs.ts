import type { LogwellConfig } from '../../src/types';

/**
 * Valid configuration fixtures for testing
 */
export const validConfigs = {
  minimal: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
  } satisfies LogwellConfig,

  full: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
    service: 'test-service',
    batchSize: 25,
    flushInterval: 3000,
    maxQueueSize: 500,
    maxRetries: 5,
    onError: () => {},
    onFlush: () => {},
  } satisfies LogwellConfig,

  withService: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
    service: 'my-app',
  } satisfies LogwellConfig,

  withSourceLocation: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
    captureSourceLocation: true,
  } satisfies LogwellConfig,
};

/**
 * Invalid configuration fixtures for testing validation
 */
export const invalidConfigs = {
  missingApiKey: {
    endpoint: 'https://test.logwell.io',
  },

  missingEndpoint: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
  },

  emptyApiKey: {
    apiKey: '',
    endpoint: 'https://test.logwell.io',
  },

  invalidApiKeyFormat: {
    apiKey: 'invalid_key_format',
    endpoint: 'https://test.logwell.io',
  },

  apiKeyTooShort: {
    apiKey: 'lw_short',
    endpoint: 'https://test.logwell.io',
  },

  apiKeyWrongPrefix: {
    apiKey: 'xx_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
  },

  invalidEndpoint: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'not-a-valid-url',
  },

  negativeBatchSize: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
    batchSize: -1,
  },

  zeroBatchSize: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
    batchSize: 0,
  },

  negativeFlushInterval: {
    apiKey: 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    endpoint: 'https://test.logwell.io',
    flushInterval: -100,
  },
};
