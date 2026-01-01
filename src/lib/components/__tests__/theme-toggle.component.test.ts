import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock mode-watcher module before importing component
const mockToggleMode = vi.fn();
let mockCurrentMode = 'light';

vi.mock('mode-watcher', () => ({
  mode: {
    get current() {
      return mockCurrentMode;
    },
  },
  toggleMode: () => mockToggleMode(),
}));

// Import component after mock setup
import ThemeToggle from '../theme-toggle.svelte';

describe('ThemeToggle', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockCurrentMode = 'light';
  });

  it('renders sun icon in light mode', () => {
    mockCurrentMode = 'light';
    render(ThemeToggle);

    const button = screen.getByRole('button', { name: /toggle theme/i });
    expect(button).toBeInTheDocument();

    // Sun icon should be visible in light mode
    const sunIcon = button.querySelector('[data-testid="sun-icon"]');
    expect(sunIcon).toBeInTheDocument();
  });

  it('renders moon icon in dark mode', () => {
    mockCurrentMode = 'dark';
    render(ThemeToggle);

    const button = screen.getByRole('button', { name: /toggle theme/i });
    expect(button).toBeInTheDocument();

    // Moon icon should be visible in dark mode
    const moonIcon = button.querySelector('[data-testid="moon-icon"]');
    expect(moonIcon).toBeInTheDocument();
  });

  it('toggles theme on click', async () => {
    mockCurrentMode = 'light';
    render(ThemeToggle);

    const button = screen.getByRole('button', { name: /toggle theme/i });
    await button.click();

    expect(mockToggleMode).toHaveBeenCalledTimes(1);
  });
});
