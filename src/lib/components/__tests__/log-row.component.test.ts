import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Log } from '$lib/server/db/schema';
import LogRow from '../log-row.svelte';

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

describe('LogRow', () => {
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

  describe('displays timestamp in HH:mm:ss.SSS format', () => {
    it('renders timestamp from log', () => {
      render(LogRow, { props: { log: baseLog } });

      expect(screen.getByText('14:30:45.123')).toBeInTheDocument();
    });

    it('renders different timestamp correctly', () => {
      const log = { ...baseLog, timestamp: new Date('2024-06-20T08:15:30.456Z') };
      render(LogRow, { props: { log } });

      expect(screen.getByText('08:15:30.456')).toBeInTheDocument();
    });

    it('handles midnight timestamp', () => {
      const log = { ...baseLog, timestamp: new Date('2024-01-01T00:00:00.000Z') };
      render(LogRow, { props: { log } });

      expect(screen.getByText('00:00:00.000')).toBeInTheDocument();
    });

    it('handles null timestamp gracefully', () => {
      const log = { ...baseLog, timestamp: null };
      render(LogRow, { props: { log } });

      // Should show a placeholder or handle gracefully
      expect(screen.getByTestId('log-timestamp-desktop')).toBeInTheDocument();
    });
  });

  describe('displays level badge', () => {
    it('renders LevelBadge component with correct level', () => {
      render(LogRow, { props: { log: baseLog } });

      expect(screen.getByText('INFO')).toBeInTheDocument();
    });

    it('renders debug level correctly', () => {
      const log = { ...baseLog, level: 'debug' as const };
      render(LogRow, { props: { log } });

      expect(screen.getByText('DEBUG')).toBeInTheDocument();
    });

    it('renders warn level correctly', () => {
      const log = { ...baseLog, level: 'warn' as const };
      render(LogRow, { props: { log } });

      expect(screen.getByText('WARN')).toBeInTheDocument();
    });

    it('renders error level correctly', () => {
      const log = { ...baseLog, level: 'error' as const };
      render(LogRow, { props: { log } });

      expect(screen.getByText('ERROR')).toBeInTheDocument();
    });

    it('renders fatal level correctly', () => {
      const log = { ...baseLog, level: 'fatal' as const };
      render(LogRow, { props: { log } });

      expect(screen.getByText('FATAL')).toBeInTheDocument();
    });
  });

  describe('truncates long messages with ellipsis', () => {
    it('displays short messages in full', () => {
      render(LogRow, { props: { log: baseLog } });

      expect(screen.getByText('User logged in successfully')).toBeInTheDocument();
    });

    it('truncates message exceeding max length', () => {
      const longMessage =
        'This is a very long log message that should be truncated because it exceeds the maximum display length for a log row in the table view';
      const log = { ...baseLog, message: longMessage };
      render(LogRow, { props: { log } });

      const messageElement = screen.getByTestId('log-message-desktop');
      expect(messageElement).toBeInTheDocument();
      // Should have CSS truncation class
      expect(messageElement).toHaveClass('truncate');
    });

    it('applies max-width constraint to message', () => {
      const log = { ...baseLog, message: 'Some message' };
      render(LogRow, { props: { log } });

      const messageElement = screen.getByTestId('log-message-desktop');
      expect(messageElement).toHaveClass('max-w-md');
    });
  });

  describe('emits click event for detail view', () => {
    it('calls onclick when row is clicked', async () => {
      const onclick = vi.fn();
      render(LogRow, { props: { log: baseLog, onclick } });

      const row = screen.getByTestId('log-row');
      await fireEvent.click(row);

      expect(onclick).toHaveBeenCalledTimes(1);
      expect(onclick).toHaveBeenCalledWith(baseLog);
    });

    it('passes the correct log object to onclick', async () => {
      const onclick = vi.fn();
      const customLog = { ...baseLog, id: 'custom_log_id', message: 'Custom message' };
      render(LogRow, { props: { log: customLog, onclick } });

      const row = screen.getByTestId('log-row');
      await fireEvent.click(row);

      expect(onclick).toHaveBeenCalledWith(customLog);
    });

    it('does not throw when onclick is not provided', async () => {
      render(LogRow, { props: { log: baseLog } });

      const row = screen.getByTestId('log-row');

      await expect(fireEvent.click(row)).resolves.not.toThrow();
    });

    it('row has cursor-pointer for visual feedback', () => {
      render(LogRow, { props: { log: baseLog } });

      const row = screen.getByTestId('log-row');
      expect(row).toHaveClass('cursor-pointer');
    });

    it('row has hover state styling', () => {
      render(LogRow, { props: { log: baseLog } });

      const row = screen.getByTestId('log-row');
      expect(row.className).toContain('hover:');
    });
  });

  describe('accessibility', () => {
    it('row is focusable via keyboard', () => {
      render(LogRow, { props: { log: baseLog } });

      const row = screen.getByTestId('log-row');
      expect(row).toHaveAttribute('tabindex', '0');
    });

    it('triggers onclick on Enter key press', async () => {
      const onclick = vi.fn();
      render(LogRow, { props: { log: baseLog, onclick } });

      const row = screen.getByTestId('log-row');
      await fireEvent.keyDown(row, { key: 'Enter' });

      expect(onclick).toHaveBeenCalledTimes(1);
      expect(onclick).toHaveBeenCalledWith(baseLog);
    });

    it('triggers onclick on Space key press', async () => {
      const onclick = vi.fn();
      render(LogRow, { props: { log: baseLog, onclick } });

      const row = screen.getByTestId('log-row');
      await fireEvent.keyDown(row, { key: ' ' });

      expect(onclick).toHaveBeenCalledTimes(1);
    });
  });

  describe('displays source info when available', () => {
    it('shows source file and line number', () => {
      render(LogRow, { props: { log: baseLog } });

      expect(screen.getByText('auth.ts:42')).toBeInTheDocument();
    });

    it('hides source info when sourceFile is null', () => {
      const log = { ...baseLog, sourceFile: null, lineNumber: null };
      render(LogRow, { props: { log } });

      expect(screen.queryByText(/auth\.ts/)).not.toBeInTheDocument();
    });

    it('shows source file without line number when lineNumber is null', () => {
      const log = { ...baseLog, lineNumber: null };
      render(LogRow, { props: { log } });

      expect(screen.getByText('auth.ts')).toBeInTheDocument();
      expect(screen.queryByText('auth.ts:42')).not.toBeInTheDocument();
    });
  });

  describe('highlight new logs', () => {
    it('applies log-new class when isNew is true', () => {
      render(LogRow, { props: { log: baseLog, isNew: true } });

      const row = screen.getByTestId('log-row');
      expect(row).toHaveClass('log-new');
    });

    it('does not apply log-new class when isNew is false', () => {
      render(LogRow, { props: { log: baseLog, isNew: false } });

      const row = screen.getByTestId('log-row');
      expect(row).not.toHaveClass('log-new');
    });

    it('does not apply log-new class when isNew is undefined', () => {
      render(LogRow, { props: { log: baseLog } });

      const row = screen.getByTestId('log-row');
      expect(row).not.toHaveClass('log-new');
    });
  });

  describe('isSelected prop for keyboard navigation', () => {
    it('renders without isSelected prop (default false)', () => {
      render(LogRow, { props: { log: baseLog } });

      const row = screen.getByTestId('log-row');
      expect(row).toHaveAttribute('data-selected', 'false');
      expect(row).not.toHaveAttribute('aria-current');
      expect(row).not.toHaveClass('bg-primary/10');
      expect(row).not.toHaveClass('ring-1');
    });

    it('applies selected class when isSelected=true', () => {
      render(LogRow, { props: { log: baseLog, isSelected: true } });

      const row = screen.getByTestId('log-row');
      expect(row).toHaveClass('bg-primary/10');
      expect(row).toHaveClass('ring-1');
      expect(row).toHaveClass('ring-primary/50');
    });

    it('does not apply selected class when isSelected=false', () => {
      render(LogRow, { props: { log: baseLog, isSelected: false } });

      const row = screen.getByTestId('log-row');
      expect(row).not.toHaveClass('bg-primary/10');
      expect(row).not.toHaveClass('ring-1');
      expect(row).not.toHaveClass('ring-primary/50');
    });

    it('has data-selected="true" when selected', () => {
      render(LogRow, { props: { log: baseLog, isSelected: true } });

      const row = screen.getByTestId('log-row');
      expect(row).toHaveAttribute('data-selected', 'true');
    });

    it('has aria-current="true" when selected', () => {
      render(LogRow, { props: { log: baseLog, isSelected: true } });

      const row = screen.getByTestId('log-row');
      expect(row).toHaveAttribute('aria-current', 'true');
    });

    it('does not have aria-current when not selected', () => {
      render(LogRow, { props: { log: baseLog, isSelected: false } });

      const row = screen.getByTestId('log-row');
      expect(row).not.toHaveAttribute('aria-current');
    });
  });
});
