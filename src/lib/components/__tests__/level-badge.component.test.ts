import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LevelBadge from '../level-badge.svelte';

describe('LevelBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ['debug', 'DEBUG', 'bg-slate'],
    ['info', 'INFO', 'bg-blue'],
    ['warn', 'WARN', 'bg-amber'],
    ['error', 'ERROR', 'bg-red'],
    ['fatal', 'FATAL', 'bg-purple'],
  ] as const)('renders %s level as %s with %s background', (level, text, bgClass) => {
    render(LevelBadge, { props: { level } });
    const badge = screen.getByText(text);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain(bgClass);
  });
});
