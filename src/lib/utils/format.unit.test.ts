import { formatFullDate, formatRelativeTime, formatTimestamp, getTimeRangeStart } from './format';

describe('formatTimestamp', () => {
  it.each([
    ['2024-01-15T14:30:45.123Z', '14:30:45.123', 'afternoon time'],
    ['2024-01-15T09:15:30.456Z', '09:15:30.456', 'morning time'],
    ['2024-01-15T00:00:00.000Z', '00:00:00.000', 'midnight'],
    ['2024-01-15T12:00:00.000Z', '12:00:00.000', 'noon'],
    ['2024-01-15T01:05:08.100Z', '01:05:08.100', 'single-digit hours'],
    ['2024-01-15T14:05:45.123Z', '14:05:45.123', 'single-digit minutes'],
    ['2024-01-15T14:30:05.123Z', '14:30:05.123', 'single-digit seconds'],
    ['2024-01-15T14:30:45.001Z', '14:30:45.001', 'single-digit milliseconds'],
    ['2024-01-15T14:30:45.010Z', '14:30:45.010', 'double-digit milliseconds'],
    ['2024-01-15T14:30:45.100Z', '14:30:45.100', 'triple-digit milliseconds'],
    ['2024-01-15T23:59:59.999Z', '23:59:59.999', 'maximum time values'],
  ])('formatTimestamp(%s) returns %s (%s)', (input, expected) => {
    expect(formatTimestamp(new Date(input))).toBe(expected);
  });

  it('handles Date object at the start of epoch', () => {
    const date = new Date(0); // 1970-01-01T00:00:00.000Z
    expect(formatTimestamp(date)).toBe('00:00:00.000');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2024-01-15T14:30:45.000Z');

  describe('seconds range', () => {
    it.each([
      [0, 'just now', 'current time'],
      [4 * 1000, 'just now', 'less than 5 seconds ago'],
      [5 * 1000, '5 seconds ago', '5 seconds ago'],
      [30 * 1000, '30 seconds ago', '30 seconds ago'],
      [59 * 1000, '59 seconds ago', '59 seconds ago'],
    ])('formatRelativeTime(%i ms ago) returns "%s" (%s)', (offset, expected) => {
      const date = new Date(now.getTime() - offset);
      expect(formatRelativeTime(date, now)).toBe(expected);
    });
  });

  describe('minutes range', () => {
    it.each([
      [60 * 1000, '1 minute ago', '60 seconds ago'],
      [2 * 60 * 1000, '2 minutes ago', '2 minutes ago'],
      [15 * 60 * 1000, '15 minutes ago', '15 minutes ago'],
      [59 * 60 * 1000, '59 minutes ago', '59 minutes ago'],
    ])('formatRelativeTime(%i ms ago) returns "%s" (%s)', (offset, expected) => {
      const date = new Date(now.getTime() - offset);
      expect(formatRelativeTime(date, now)).toBe(expected);
    });
  });

  describe('hours range', () => {
    it.each([
      [60 * 60 * 1000, '1 hour ago', '60 minutes ago'],
      [2 * 60 * 60 * 1000, '2 hours ago', '2 hours ago'],
      [12 * 60 * 60 * 1000, '12 hours ago', '12 hours ago'],
      [23 * 60 * 60 * 1000, '23 hours ago', '23 hours ago'],
    ])('formatRelativeTime(%i ms ago) returns "%s" (%s)', (offset, expected) => {
      const date = new Date(now.getTime() - offset);
      expect(formatRelativeTime(date, now)).toBe(expected);
    });
  });

  describe('days range', () => {
    it.each([
      [24 * 60 * 60 * 1000, '1 day ago', '24 hours ago'],
      [2 * 24 * 60 * 60 * 1000, '2 days ago', '2 days ago'],
      [7 * 24 * 60 * 60 * 1000, '7 days ago', '7 days ago'],
      [30 * 24 * 60 * 60 * 1000, '30 days ago', '30 days ago'],
    ])('formatRelativeTime(%i ms ago) returns "%s" (%s)', (offset, expected) => {
      const date = new Date(now.getTime() - offset);
      expect(formatRelativeTime(date, now)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('handles future dates gracefully', () => {
      const futureDate = new Date(now.getTime() + 5 * 60 * 1000);
      // Should either return "just now" or a negative indication
      const result = formatRelativeTime(futureDate, now);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('uses current time when reference time is not provided', () => {
      const pastDate = new Date(Date.now() - 10 * 1000);
      const result = formatRelativeTime(pastDate);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });
});

describe('getTimeRangeStart', () => {
  const now = new Date('2024-01-15T14:30:45.123Z');

  it.each([
    ['15m', 15 * 60 * 1000, '15 minutes'],
    ['1h', 60 * 60 * 1000, '1 hour'],
    ['24h', 24 * 60 * 60 * 1000, '24 hours'],
    ['7d', 7 * 24 * 60 * 60 * 1000, '7 days'],
  ])('getTimeRangeStart(%s) returns Date %i ms before reference time (%s)', (range, offset) => {
    const result = getTimeRangeStart(range, now);
    const expected = new Date(now.getTime() - offset);
    expect(result).toEqual(expected);
    expect(result.getTime()).toBe(now.getTime() - offset);
  });

  it('uses current time when reference time is not provided', () => {
    const before = Date.now();
    const result = getTimeRangeStart('1h');
    const after = Date.now();

    // Result should be approximately 1 hour before now
    expect(result.getTime()).toBeGreaterThanOrEqual(before - 60 * 60 * 1000);
    expect(result.getTime()).toBeLessThanOrEqual(after - 60 * 60 * 1000);
  });

  it('returns a Date object for all valid ranges', () => {
    expect(getTimeRangeStart('15m', now)).toBeInstanceOf(Date);
    expect(getTimeRangeStart('1h', now)).toBeInstanceOf(Date);
    expect(getTimeRangeStart('24h', now)).toBeInstanceOf(Date);
    expect(getTimeRangeStart('7d', now)).toBeInstanceOf(Date);
  });

  it('preserves millisecond precision', () => {
    const result = getTimeRangeStart('1h', now);
    // If now has milliseconds, the result should maintain them
    expect(result.getMilliseconds()).toBe(now.getMilliseconds());
  });
});

describe('formatFullDate', () => {
  it.each([
    ['2024-01-15T14:30:45.123Z', '2024-01-15 14:30:45.123 UTC', 'afternoon time'],
    ['2024-06-20T08:15:30.456Z', '2024-06-20 08:15:30.456 UTC', 'morning time'],
    ['2024-01-01T00:00:00.000Z', '2024-01-01 00:00:00.000 UTC', 'midnight'],
    ['2024-12-31T23:59:59.999Z', '2024-12-31 23:59:59.999 UTC', 'end of year'],
    ['2024-01-15T14:30:45.123Z', '2024-01-15 14:30:45.123 UTC', 'single-digit month'],
    ['2024-01-05T14:30:45.123Z', '2024-01-05 14:30:45.123 UTC', 'single-digit day'],
    ['2024-11-20T14:30:45.123Z', '2024-11-20 14:30:45.123 UTC', 'double-digit month'],
    ['2024-01-15T14:30:45.001Z', '2024-01-15 14:30:45.001 UTC', 'single-digit milliseconds'],
    ['2024-01-15T14:30:45.010Z', '2024-01-15 14:30:45.010 UTC', 'double-digit milliseconds'],
  ])('formatFullDate(%s) returns %s (%s)', (input, expected) => {
    expect(formatFullDate(new Date(input))).toBe(expected);
  });

  it('handles epoch start', () => {
    const date = new Date(0); // 1970-01-01T00:00:00.000Z
    expect(formatFullDate(date)).toBe('1970-01-01 00:00:00.000 UTC');
  });
});
