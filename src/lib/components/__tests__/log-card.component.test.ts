import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Log } from '$lib/server/db/schema';
import LogCard from '../log-card.svelte';

// Mock formatTimestamp to have deterministic output
vi.mock('$lib/utils/format', () => ({
  formatTimestamp: vi.fn((date: Date) => {
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }),
}));

describe('LogCard', () => {
  const baseLog: Log = {
    id: 'log_123',
    projectId: 'proj_456',
    level: 'info',
    message: 'User logged in successfully',
    metadata: { userId: 'user_789' },
    timeUnixNano: null,
    observedTimeUnixNano: null,
    severityNumber: null,
    severityText: null,
    body: null,
    droppedAttributesCount: null,
    flags: null,
    traceId: null,
    spanId: null,
    resourceAttributes: null,
    resourceDroppedAttributesCount: null,
    resourceSchemaUrl: null,
    scopeName: null,
    scopeVersion: null,
    scopeAttributes: null,
    scopeDroppedAttributesCount: null,
    scopeSchemaUrl: null,
    sourceFile: 'auth.ts',
    lineNumber: 42,
    requestId: 'req_abc',
    userId: 'user_789',
    ipAddress: '192.168.1.1',
    timestamp: new Date('2024-01-15T14:30:45.123Z'),
    search: '',
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('highlight new logs', () => {
    it('applies log-new class when isNew is true', () => {
      render(LogCard, { props: { log: baseLog, isNew: true } });

      const card = screen.getByTestId('log-card');
      expect(card).toHaveClass('log-new');
    });

    it('does not apply log-new class when isNew is false', () => {
      render(LogCard, { props: { log: baseLog, isNew: false } });

      const card = screen.getByTestId('log-card');
      expect(card).not.toHaveClass('log-new');
    });

    it('does not apply log-new class when isNew is undefined', () => {
      render(LogCard, { props: { log: baseLog } });

      const card = screen.getByTestId('log-card');
      expect(card).not.toHaveClass('log-new');
    });
  });

  describe('renders log information', () => {
    it('displays log message', () => {
      render(LogCard, { props: { log: baseLog } });

      expect(screen.getByText('User logged in successfully')).toBeInTheDocument();
    });

    it('displays level badge', () => {
      render(LogCard, { props: { log: baseLog } });

      expect(screen.getByText('INFO')).toBeInTheDocument();
    });

    it('displays timestamp', () => {
      render(LogCard, { props: { log: baseLog } });

      expect(screen.getByText('14:30:45.123')).toBeInTheDocument();
    });
  });

  describe('onclick handler', () => {
    it('calls onclick when card is clicked', async () => {
      const onclick = vi.fn();
      render(LogCard, { props: { log: baseLog, onclick } });

      const card = screen.getByTestId('log-card');
      await fireEvent.click(card);

      expect(onclick).toHaveBeenCalledTimes(1);
      expect(onclick).toHaveBeenCalledWith(baseLog);
    });

    it('does not throw when onclick is not provided', async () => {
      render(LogCard, { props: { log: baseLog } });

      const card = screen.getByTestId('log-card');

      await expect(fireEvent.click(card)).resolves.not.toThrow();
    });
  });

  describe('isSelected prop for keyboard navigation', () => {
    it('renders without isSelected prop (default false)', () => {
      render(LogCard, { props: { log: baseLog } });

      const card = screen.getByTestId('log-card');
      expect(card).toHaveAttribute('data-selected', 'false');
      expect(card).not.toHaveAttribute('aria-current');
      expect(card).not.toHaveClass('bg-primary/10');
      expect(card).not.toHaveClass('ring-1');
    });

    it('applies selected class when isSelected=true', () => {
      render(LogCard, { props: { log: baseLog, isSelected: true } });

      const card = screen.getByTestId('log-card');
      expect(card).toHaveClass('bg-primary/10');
      expect(card).toHaveClass('ring-1');
      expect(card).toHaveClass('ring-primary/50');
    });

    it('has data-selected="true" when selected', () => {
      render(LogCard, { props: { log: baseLog, isSelected: true } });

      const card = screen.getByTestId('log-card');
      expect(card).toHaveAttribute('data-selected', 'true');
    });

    it('has aria-current="true" when selected', () => {
      render(LogCard, { props: { log: baseLog, isSelected: true } });

      const card = screen.getByTestId('log-card');
      expect(card).toHaveAttribute('aria-current', 'true');
    });
  });
});
