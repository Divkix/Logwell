import { describe, expect, it } from 'vitest';
import { getIncidentStatus } from './incidents';

describe('incident status helpers', () => {
  it('returns open when within threshold', () => {
    const now = new Date('2026-02-12T12:00:00.000Z');
    const lastSeen = new Date('2026-02-12T11:31:00.000Z');

    expect(getIncidentStatus(lastSeen, now, 30)).toBe('open');
  });

  it('returns open exactly at threshold boundary', () => {
    const now = new Date('2026-02-12T12:00:00.000Z');
    const lastSeen = new Date('2026-02-12T11:30:00.000Z');

    expect(getIncidentStatus(lastSeen, now, 30)).toBe('open');
  });

  it('returns resolved after threshold passes', () => {
    const now = new Date('2026-02-12T12:00:01.000Z');
    const lastSeen = new Date('2026-02-12T11:30:00.000Z');

    expect(getIncidentStatus(lastSeen, now, 30)).toBe('resolved');
  });
});
