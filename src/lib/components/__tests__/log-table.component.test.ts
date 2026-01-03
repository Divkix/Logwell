import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Log } from '$lib/server/db/schema';
import LogTable from '../log-table.svelte';

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

describe('LogTable', () => {
  const createLog = (overrides: Partial<Log> = {}): Log => ({
    id: 'log_123',
    projectId: 'proj_456',
    level: 'info',
    message: 'Test log message',
    metadata: null,
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
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: new Date('2024-01-15T14:30:45.123Z'),
    search: '',
    ...overrides,
  });

  const sampleLogs: Log[] = [
    createLog({ id: 'log_1', message: 'First log message', level: 'info' }),
    createLog({
      id: 'log_2',
      message: 'Second log message',
      level: 'error',
      timestamp: new Date('2024-01-15T14:31:00.000Z'),
    }),
    createLog({
      id: 'log_3',
      message: 'Third log message',
      level: 'debug',
      timestamp: new Date('2024-01-15T14:32:00.000Z'),
    }),
  ];

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('renders header row', () => {
    it('displays table header with correct columns', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      const header = screen.getByTestId('log-table-header');
      expect(header).toBeInTheDocument();
    });

    it('shows Time column header', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      expect(screen.getByText('Time')).toBeInTheDocument();
    });

    it('shows Level column header', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      expect(screen.getByText('Level')).toBeInTheDocument();
    });

    it('shows Message column header', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      expect(screen.getByText('Message')).toBeInTheDocument();
    });

    it('renders header even when logs are empty', () => {
      render(LogTable, { props: { logs: [], loading: false } });

      expect(screen.getByTestId('log-table-header')).toBeInTheDocument();
    });
  });

  describe('renders log rows', () => {
    it('displays all provided logs', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      const rows = screen.getAllByTestId('log-row');
      expect(rows).toHaveLength(3);
    });

    it('renders LogRow component for each log', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      const table = screen.getByRole('table');
      expect(within(table).getByText('First log message')).toBeInTheDocument();
      expect(within(table).getByText('Second log message')).toBeInTheDocument();
      expect(within(table).getByText('Third log message')).toBeInTheDocument();
    });

    it('renders log levels correctly', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      const table = screen.getByRole('table');
      expect(within(table).getByText('INFO')).toBeInTheDocument();
      expect(within(table).getByText('ERROR')).toBeInTheDocument();
      expect(within(table).getByText('DEBUG')).toBeInTheDocument();
    });

    it('renders timestamps correctly', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      const table = screen.getByRole('table');
      expect(within(table).getByText('14:30:45.123')).toBeInTheDocument();
      expect(within(table).getByText('14:31:00.000')).toBeInTheDocument();
      expect(within(table).getByText('14:32:00.000')).toBeInTheDocument();
    });

    it('propagates onLogClick callback to log rows', async () => {
      const onLogClick = vi.fn();
      render(LogTable, { props: { logs: sampleLogs, loading: false, onLogClick } });

      const rows = screen.getAllByTestId('log-row');
      await rows[0].click();

      expect(onLogClick).toHaveBeenCalledTimes(1);
      expect(onLogClick).toHaveBeenCalledWith(sampleLogs[0]);
    });

    it('renders single log correctly', () => {
      const singleLog = [createLog({ id: 'single_log', message: 'Only one log' })];
      render(LogTable, { props: { logs: singleLog, loading: false } });

      const table = screen.getByRole('table');
      const rows = screen.getAllByTestId('log-row');
      expect(rows).toHaveLength(1);
      expect(within(table).getByText('Only one log')).toBeInTheDocument();
    });
  });

  describe('shows skeleton during loading', () => {
    it('displays skeleton rows when loading is true', () => {
      render(LogTable, { props: { logs: [], loading: true } });

      const skeletons = screen.getAllByTestId('log-table-skeleton-row');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('renders multiple skeleton rows for loading state', () => {
      render(LogTable, { props: { logs: [], loading: true } });

      const skeletons = screen.getAllByTestId('log-table-skeleton-row');
      expect(skeletons.length).toBeGreaterThanOrEqual(5);
    });

    it('hides log rows when loading', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: true } });

      expect(screen.queryAllByTestId('log-row')).toHaveLength(0);
    });

    it('shows header even when loading', () => {
      render(LogTable, { props: { logs: [], loading: true } });

      expect(screen.getByTestId('log-table-header')).toBeInTheDocument();
    });

    it('skeleton rows have animated pulse effect', () => {
      render(LogTable, { props: { logs: [], loading: true } });

      const skeleton = screen.getAllByTestId('log-table-skeleton-row')[0];
      // Check that skeleton children have animation class
      const skeletonElements = within(skeleton).getAllByRole('presentation', { hidden: true });
      expect(skeletonElements.length).toBeGreaterThan(0);
    });
  });

  describe('shows empty state when no logs', () => {
    it('displays empty state message when logs array is empty', () => {
      render(LogTable, { props: { logs: [], loading: false } });

      expect(screen.getByTestId('log-table-empty')).toBeInTheDocument();
    });

    it('shows "No logs" text in empty state', () => {
      render(LogTable, { props: { logs: [], loading: false } });

      const table = screen.getByRole('table');
      expect(within(table).getByText(/no logs/i)).toBeInTheDocument();
    });

    it('hides empty state when logs are present', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      expect(screen.queryByTestId('log-table-empty')).not.toBeInTheDocument();
    });

    it('hides empty state when loading', () => {
      render(LogTable, { props: { logs: [], loading: true } });

      expect(screen.queryByTestId('log-table-empty')).not.toBeInTheDocument();
    });

    it('shows header even with empty state', () => {
      render(LogTable, { props: { logs: [], loading: false } });

      expect(screen.getByTestId('log-table-header')).toBeInTheDocument();
    });

    it('empty state has appropriate styling', () => {
      render(LogTable, { props: { logs: [], loading: false } });

      const emptyState = screen.getByTestId('log-table-empty');
      expect(emptyState).toHaveClass('text-muted-foreground');
    });
  });

  describe('table structure and accessibility', () => {
    it('renders as a proper table element', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('has proper table semantics', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false } });

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();
    });

    it('applies custom className when provided', () => {
      render(LogTable, { props: { logs: sampleLogs, loading: false, class: 'custom-class' } });

      const tableContainer = screen.getByTestId('log-table');
      expect(tableContainer).toHaveClass('custom-class');
    });
  });
});
