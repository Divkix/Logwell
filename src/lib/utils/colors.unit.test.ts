import { getLevelBgClass, getLevelColor } from './colors';

describe('getLevelColor', () => {
  it.each([
    ['debug', 'hsl(215, 15%, 50%)'],
    ['info', 'hsl(210, 100%, 50%)'],
    ['warn', 'hsl(45, 100%, 50%)'],
    ['error', 'hsl(0, 85%, 55%)'],
    ['fatal', 'hsl(270, 70%, 55%)'],
  ] as const)('returns %s for %s level', (level, expected) => {
    const result = getLevelColor(level);
    expect(result).toBe(expected);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^hsl\(\d+,\s*\d+%,\s*\d+%\)$/);
  });
});

describe('getLevelBgClass', () => {
  it.each([
    ['debug', 'bg-slate-500/20', 'slate'],
    ['info', 'bg-blue-500/20', 'blue'],
    ['warn', 'bg-amber-500/20', 'amber'],
    ['error', 'bg-red-500/20', 'red'],
    ['fatal', 'bg-purple-500/20', 'purple'],
  ] as const)('returns %s for %s level with semantic color %s', (level, expected, colorFamily) => {
    const result = getLevelBgClass(level);
    expect(result).toBe(expected);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^bg-[\w-]+\/\d+$/);
    expect(result).toContain('/20');
    expect(result).toContain(colorFamily);
  });
});
