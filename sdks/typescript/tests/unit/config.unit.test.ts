import { describe, expect, it } from 'vitest';
import {
  API_KEY_REGEX,
  DEFAULT_CONFIG,
  validateApiKeyFormat,
  validateConfig,
} from '../../src/config';
import { LogwellError } from '../../src/errors';
import { invalidConfigs, validConfigs } from '../fixtures/configs';

describe('API_KEY_REGEX', () => {
  it('matches valid API key format', () => {
    const validKey = 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456';
    expect(API_KEY_REGEX.test(validKey)).toBe(true);
  });

  it('rejects keys without lw_ prefix', () => {
    const invalidKey = 'xx_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456';
    expect(API_KEY_REGEX.test(invalidKey)).toBe(false);
  });

  it('rejects keys with wrong length', () => {
    const tooShort = 'lw_short';
    const tooLong = 'lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456extra';
    expect(API_KEY_REGEX.test(tooShort)).toBe(false);
    expect(API_KEY_REGEX.test(tooLong)).toBe(false);
  });

  it('allows hyphens and underscores in key body', () => {
    // Must be exactly 32 chars after lw_ prefix
    const withHyphen = 'lw_aBcDeFgHiJkLmNo-qRsTuVwXyZ123456';
    const withUnderscore = 'lw_aBcDeFgHiJkLmNo_qRsTuVwXyZ123456';
    expect(API_KEY_REGEX.test(withHyphen)).toBe(true);
    expect(API_KEY_REGEX.test(withUnderscore)).toBe(true);
  });
});

describe('validateApiKeyFormat', () => {
  it('returns true for valid API key', () => {
    expect(validateApiKeyFormat('lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(validateApiKeyFormat('')).toBe(false);
  });

  it('returns false for invalid format', () => {
    expect(validateApiKeyFormat('invalid')).toBe(false);
  });

  it('returns false for wrong prefix', () => {
    expect(validateApiKeyFormat('xx_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')).toBe(false);
  });

  it('returns false for short key', () => {
    expect(validateApiKeyFormat('lw_short')).toBe(false);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has correct default batchSize', () => {
    expect(DEFAULT_CONFIG.batchSize).toBe(50);
  });

  it('has correct default flushInterval', () => {
    expect(DEFAULT_CONFIG.flushInterval).toBe(5000);
  });

  it('has correct default maxQueueSize', () => {
    expect(DEFAULT_CONFIG.maxQueueSize).toBe(1000);
  });

  it('has correct default maxRetries', () => {
    expect(DEFAULT_CONFIG.maxRetries).toBe(3);
  });
});

describe('validateConfig', () => {
  describe('valid configurations', () => {
    it('accepts minimal valid config', () => {
      const result = validateConfig(validConfigs.minimal);

      expect(result.apiKey).toBe(validConfigs.minimal.apiKey);
      expect(result.endpoint).toBe(validConfigs.minimal.endpoint);
    });

    it('merges defaults for missing optional fields', () => {
      const result = validateConfig(validConfigs.minimal);

      expect(result.batchSize).toBe(DEFAULT_CONFIG.batchSize);
      expect(result.flushInterval).toBe(DEFAULT_CONFIG.flushInterval);
      expect(result.maxQueueSize).toBe(DEFAULT_CONFIG.maxQueueSize);
      expect(result.maxRetries).toBe(DEFAULT_CONFIG.maxRetries);
    });

    it('preserves provided optional values', () => {
      const result = validateConfig(validConfigs.full);

      expect(result.batchSize).toBe(25);
      expect(result.flushInterval).toBe(3000);
      expect(result.maxQueueSize).toBe(500);
      expect(result.maxRetries).toBe(5);
    });

    it('preserves service name', () => {
      const result = validateConfig(validConfigs.withService);

      expect(result.service).toBe('my-app');
    });

    it('preserves callback functions', () => {
      const onError = vi.fn();
      const onFlush = vi.fn();
      const config = {
        ...validConfigs.minimal,
        onError,
        onFlush,
      };

      const result = validateConfig(config);

      expect(result.onError).toBe(onError);
      expect(result.onFlush).toBe(onFlush);
    });
  });

  describe('invalid configurations', () => {
    it('throws LogwellError for missing apiKey', () => {
      expect(() => validateConfig(invalidConfigs.missingApiKey)).toThrow(LogwellError);
      expect(() => validateConfig(invalidConfigs.missingApiKey)).toThrow('apiKey is required');
    });

    it('throws LogwellError for missing endpoint', () => {
      expect(() => validateConfig(invalidConfigs.missingEndpoint)).toThrow(LogwellError);
      expect(() => validateConfig(invalidConfigs.missingEndpoint)).toThrow('endpoint is required');
    });

    it('throws LogwellError for empty apiKey', () => {
      expect(() => validateConfig(invalidConfigs.emptyApiKey)).toThrow(LogwellError);
    });

    it('throws LogwellError for invalid apiKey format', () => {
      expect(() => validateConfig(invalidConfigs.invalidApiKeyFormat)).toThrow(LogwellError);
      expect(() => validateConfig(invalidConfigs.invalidApiKeyFormat)).toThrow(
        'Invalid API key format',
      );
    });

    it('throws LogwellError for apiKey with wrong prefix', () => {
      expect(() => validateConfig(invalidConfigs.apiKeyWrongPrefix)).toThrow(LogwellError);
    });

    it('throws LogwellError for apiKey too short', () => {
      expect(() => validateConfig(invalidConfigs.apiKeyTooShort)).toThrow(LogwellError);
    });

    it('throws LogwellError for invalid endpoint URL', () => {
      expect(() => validateConfig(invalidConfigs.invalidEndpoint)).toThrow(LogwellError);
      expect(() => validateConfig(invalidConfigs.invalidEndpoint)).toThrow('Invalid endpoint URL');
    });

    it('throws LogwellError for negative batchSize', () => {
      expect(() => validateConfig(invalidConfigs.negativeBatchSize)).toThrow(LogwellError);
      expect(() => validateConfig(invalidConfigs.negativeBatchSize)).toThrow(
        'batchSize must be positive',
      );
    });

    it('throws LogwellError for zero batchSize', () => {
      expect(() => validateConfig(invalidConfigs.zeroBatchSize)).toThrow(LogwellError);
    });

    it('throws LogwellError for negative flushInterval', () => {
      expect(() => validateConfig(invalidConfigs.negativeFlushInterval)).toThrow(LogwellError);
      expect(() => validateConfig(invalidConfigs.negativeFlushInterval)).toThrow(
        'flushInterval must be positive',
      );
    });
  });

  describe('error details', () => {
    it('throws with INVALID_CONFIG error code', () => {
      try {
        validateConfig(invalidConfigs.missingApiKey);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LogwellError);
        expect((error as LogwellError).code).toBe('INVALID_CONFIG');
      }
    });

    it('throws non-retryable error', () => {
      try {
        validateConfig(invalidConfigs.missingApiKey);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as LogwellError).retryable).toBe(false);
      }
    });
  });

  describe('captureSourceLocation', () => {
    it('defaults captureSourceLocation to false', () => {
      const result = validateConfig(validConfigs.minimal);
      expect(result.captureSourceLocation).toBe(false);
    });

    it('preserves captureSourceLocation when set to true', () => {
      const result = validateConfig({
        ...validConfigs.minimal,
        captureSourceLocation: true,
      });
      expect(result.captureSourceLocation).toBe(true);
    });

    it('preserves captureSourceLocation when set to false explicitly', () => {
      const result = validateConfig({
        ...validConfigs.minimal,
        captureSourceLocation: false,
      });
      expect(result.captureSourceLocation).toBe(false);
    });
  });
});
