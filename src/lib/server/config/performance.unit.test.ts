import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Performance Configuration', () => {
  // Store original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module cache to allow re-importing with new env
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('SSE Batching Configuration', () => {
    it.each([
      ['BATCH_WINDOW_MS', 1500],
      ['MAX_BATCH_SIZE', 50],
      ['HEARTBEAT_INTERVAL_MS', 30000],
    ])('exports %s with default value of %d', async (key, expected) => {
      vi.resetModules();
      const { SSE_CONFIG } = await import('./performance');
      expect(SSE_CONFIG[key as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it.each([
      ['SSE_BATCH_WINDOW_MS', 'BATCH_WINDOW_MS', '2000', 2000],
      ['SSE_MAX_BATCH_SIZE', 'MAX_BATCH_SIZE', '100', 100],
      ['SSE_HEARTBEAT_INTERVAL_MS', 'HEARTBEAT_INTERVAL_MS', '60000', 60000],
    ])('respects %s environment variable', async (envKey, configKey, envValue, expected) => {
      vi.resetModules();
      process.env[envKey] = envValue;
      const { SSE_CONFIG } = await import('./performance');
      expect(SSE_CONFIG[configKey as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it.each([
      ['SSE_BATCH_WINDOW_MS', 'BATCH_WINDOW_MS', '50', 100],
      ['SSE_MAX_BATCH_SIZE', 'MAX_BATCH_SIZE', '0', 1],
      ['SSE_HEARTBEAT_INTERVAL_MS', 'HEARTBEAT_INTERVAL_MS', '1000', 5000],
    ])('clamps %s to minimum', async (envKey, configKey, envValue, expected) => {
      vi.resetModules();
      process.env[envKey] = envValue;
      const { SSE_CONFIG } = await import('./performance');
      expect(SSE_CONFIG[configKey as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it('ignores invalid (non-numeric) environment values', async () => {
      process.env.SSE_BATCH_WINDOW_MS = 'invalid';
      const { SSE_CONFIG } = await import('./performance');
      expect(SSE_CONFIG.BATCH_WINDOW_MS).toBe(1500);
    });
  });

  describe('Log Stream Configuration', () => {
    it('exports DEFAULT_MAX_LOGS with value of 1000', async () => {
      const { LOG_STREAM_CONFIG } = await import('./performance');
      expect(LOG_STREAM_CONFIG.DEFAULT_MAX_LOGS).toBe(1000);
    });

    it('exports MAX_LOGS_UPPER_LIMIT with value of 10000', async () => {
      const { LOG_STREAM_CONFIG } = await import('./performance');
      expect(LOG_STREAM_CONFIG.MAX_LOGS_UPPER_LIMIT).toBe(10000);
    });

    it('respects LOG_STREAM_MAX_LOGS environment variable', async () => {
      process.env.LOG_STREAM_MAX_LOGS = '5000';
      const { LOG_STREAM_CONFIG } = await import('./performance');
      expect(LOG_STREAM_CONFIG.DEFAULT_MAX_LOGS).toBe(5000);
    });

    it('clamps DEFAULT_MAX_LOGS to MAX_LOGS_UPPER_LIMIT', async () => {
      process.env.LOG_STREAM_MAX_LOGS = '20000';
      const { LOG_STREAM_CONFIG } = await import('./performance');
      expect(LOG_STREAM_CONFIG.DEFAULT_MAX_LOGS).toBe(10000);
    });
  });

  describe('API Rate Limiting Configuration', () => {
    it('exports BATCH_INSERT_LIMIT with default value of 100', async () => {
      const { API_CONFIG } = await import('./performance');
      expect(API_CONFIG.BATCH_INSERT_LIMIT).toBe(100);
    });

    it('exports DEFAULT_PAGE_SIZE with value of 100', async () => {
      const { API_CONFIG } = await import('./performance');
      expect(API_CONFIG.DEFAULT_PAGE_SIZE).toBe(100);
    });

    it('exports MAX_PAGE_SIZE with value of 500', async () => {
      const { API_CONFIG } = await import('./performance');
      expect(API_CONFIG.MAX_PAGE_SIZE).toBe(500);
    });
  });

  describe('Incident Configuration', () => {
    it('exports AUTO_RESOLVE_MINUTES with default value of 30', async () => {
      const { INCIDENT_CONFIG } = await import('./performance');
      expect(INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES).toBe(30);
    });

    it('respects INCIDENT_AUTO_RESOLVE_MINUTES environment variable', async () => {
      process.env.INCIDENT_AUTO_RESOLVE_MINUTES = '45';
      const { INCIDENT_CONFIG } = await import('./performance');
      expect(INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES).toBe(45);
    });

    it('clamps INCIDENT_AUTO_RESOLVE_MINUTES to minimum', async () => {
      process.env.INCIDENT_AUTO_RESOLVE_MINUTES = '0';
      const { INCIDENT_CONFIG } = await import('./performance');
      expect(INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES).toBe(1);
    });
  });

  describe('Configuration Validation', () => {
    it('validateSSEConfig returns true for valid config', async () => {
      const { validateSSEConfig, SSE_CONFIG } = await import('./performance');
      expect(validateSSEConfig(SSE_CONFIG)).toBe(true);
    });

    it('validateSSEConfig returns false for invalid batch window', async () => {
      const { validateSSEConfig } = await import('./performance');
      const invalidConfig = {
        BATCH_WINDOW_MS: -1,
        MAX_BATCH_SIZE: 50,
        HEARTBEAT_INTERVAL_MS: 30000,
      };
      expect(validateSSEConfig(invalidConfig)).toBe(false);
    });

    it('validateSSEConfig returns false for invalid batch size', async () => {
      const { validateSSEConfig } = await import('./performance');
      const invalidConfig = {
        BATCH_WINDOW_MS: 1500,
        MAX_BATCH_SIZE: 0,
        HEARTBEAT_INTERVAL_MS: 30000,
      };
      expect(validateSSEConfig(invalidConfig)).toBe(false);
    });
  });
});
