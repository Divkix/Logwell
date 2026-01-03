import { describe, expect, it } from 'vitest';
import { LOG_LEVELS, logLevelSchema } from './log';

describe('logLevelSchema', () => {
  it('accepts all valid log levels', () => {
    for (const level of LOG_LEVELS) {
      const result = logLevelSchema.safeParse(level);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid log level', () => {
    const result = logLevelSchema.safeParse('invalid');
    expect(result.success).toBe(false);
  });
});

