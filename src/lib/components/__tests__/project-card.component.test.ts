import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectCard from '../project-card.svelte';

// Mock formatRelativeTime to have deterministic output
vi.mock('$lib/utils/format', () => ({
  formatRelativeTime: vi.fn((date: Date) => {
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes === 1) return '1 minute ago';
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return '1 day ago';
    return `${diffDays} days ago`;
  }),
}));

describe('ProjectCard', () => {
  const baseProject = {
    id: 'proj_123',
    name: 'my-backend',
    logCount: 15420,
    lastActivity: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('displays project name', () => {
    render(ProjectCard, { props: { project: baseProject } });

    expect(screen.getByText('my-backend')).toBeInTheDocument();
  });

  it('displays log count formatted with commas', () => {
    render(ProjectCard, { props: { project: baseProject } });

    expect(screen.getByText('15,420 logs')).toBeInTheDocument();
  });

  it('displays log count singular for 1 log', () => {
    const project = { ...baseProject, logCount: 1 };
    render(ProjectCard, { props: { project } });

    expect(screen.getByText('1 log')).toBeInTheDocument();
  });

  it('displays zero logs correctly', () => {
    const project = { ...baseProject, logCount: 0 };
    render(ProjectCard, { props: { project } });

    expect(screen.getByText('0 logs')).toBeInTheDocument();
  });

  it('displays relative last activity', () => {
    render(ProjectCard, { props: { project: baseProject } });

    expect(screen.getByText(/Last log:/)).toBeInTheDocument();
    expect(screen.getByText(/2 minutes ago/)).toBeInTheDocument();
  });

  it('displays "No logs yet" when lastActivity is null', () => {
    const project = { ...baseProject, lastActivity: null };
    render(ProjectCard, { props: { project } });

    expect(screen.getByText('No logs yet')).toBeInTheDocument();
  });

  it('View Logs button is rendered', () => {
    render(ProjectCard, { props: { project: baseProject } });

    // Button is now a regular button - navigation is handled by parent anchor wrapper
    const button = screen.getByRole('button', { name: /view logs/i });
    expect(button).toBeInTheDocument();
  });

  it('displays large log counts with proper formatting', () => {
    const project = { ...baseProject, logCount: 1234567 };
    render(ProjectCard, { props: { project } });

    expect(screen.getByText('1,234,567 logs')).toBeInTheDocument();
  });
});
