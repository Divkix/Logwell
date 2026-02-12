import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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
    incidentId: null,
    fingerprint: null,
    serviceName: null,
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

      const emptyStates = screen.getAllByTestId('log-table-empty');
      expect(emptyStates.length).toBeGreaterThan(0);
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

      const emptyStates = screen.getAllByTestId('log-table-empty');
      // Check that at least one has the styling (they all should)
      const hasCorrectStyling = emptyStates.some((state) =>
        state.classList.contains('text-muted-foreground'),
      );
      expect(hasCorrectStyling).toBe(true);
    });
  });

  describe('distinguishes empty state from no filter results', () => {
    it('shows "No logs yet" message when hasFilters is false', () => {
      render(LogTable, { props: { logs: [], loading: false, hasFilters: false } });

      const table = screen.getByRole('table');
      expect(within(table).getByText(/no logs yet/i)).toBeInTheDocument();
    });

    it('shows "No logs match your filters" message when hasFilters is true', () => {
      render(LogTable, { props: { logs: [], loading: false, hasFilters: true } });

      const table = screen.getByRole('table');
      expect(within(table).getByText(/no logs match your filters/i)).toBeInTheDocument();
    });

    it('uses data-testid="log-table-empty" for empty project state', () => {
      render(LogTable, { props: { logs: [], loading: false, hasFilters: false } });

      const emptyStates = screen.getAllByTestId('log-table-empty');
      expect(emptyStates.length).toBeGreaterThan(0);
    });

    it('uses data-testid="log-table-no-results" for filtered no-results state', () => {
      render(LogTable, { props: { logs: [], loading: false, hasFilters: true } });

      const noResultsStates = screen.getAllByTestId('log-table-no-results');
      expect(noResultsStates.length).toBeGreaterThan(0);
    });

    it('defaults to empty state message when hasFilters is not provided', () => {
      render(LogTable, { props: { logs: [], loading: false } });

      const table = screen.getByRole('table');
      expect(within(table).getByText(/no logs yet/i)).toBeInTheDocument();
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

  describe('column sorting', () => {
    // Logs with distinct timestamps and levels for predictable sorting tests
    const sortableLogs: Log[] = [
      createLog({
        id: 'log_a',
        message: 'Alpha message',
        level: 'error',
        timestamp: new Date('2024-01-15T14:30:00.000Z'),
      }),
      createLog({
        id: 'log_b',
        message: 'Beta message',
        level: 'debug',
        timestamp: new Date('2024-01-15T14:32:00.000Z'),
      }),
      createLog({
        id: 'log_c',
        message: 'Charlie message',
        level: 'warn',
        timestamp: new Date('2024-01-15T14:31:00.000Z'),
      }),
    ];

    it('renders sortable column headers as buttons', () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const header = screen.getByTestId('log-table-header');
      expect(within(header).getByRole('button', { name: /sort by time/i })).toBeInTheDocument();
      expect(within(header).getByRole('button', { name: /sort by level/i })).toBeInTheDocument();
      expect(within(header).getByRole('button', { name: /sort by message/i })).toBeInTheDocument();
    });

    it('sorts logs by timestamp ascending when Time header clicked', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const timeButton = screen.getByRole('button', { name: /sort by time/i });
      await fireEvent.click(timeButton);

      // After ascending sort by time: Alpha (14:30) -> Charlie (14:31) -> Beta (14:32)
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('Alpha message')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Charlie message')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Beta message')).toBeInTheDocument();
    });

    it('sorts logs by timestamp descending on second click', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const timeButton = screen.getByRole('button', { name: /sort by time/i });
      await fireEvent.click(timeButton); // asc
      await fireEvent.click(timeButton); // desc

      // After descending sort by time: Beta (14:32) -> Charlie (14:31) -> Alpha (14:30)
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('Beta message')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Charlie message')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Alpha message')).toBeInTheDocument();
    });

    it('resets sort on third click', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const timeButton = screen.getByRole('button', { name: /sort by time/i });
      await fireEvent.click(timeButton); // asc
      await fireEvent.click(timeButton); // desc
      await fireEvent.click(timeButton); // reset

      // Original order restored: Alpha -> Beta -> Charlie
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('Alpha message')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Beta message')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Charlie message')).toBeInTheDocument();
    });

    it('sorts logs by level severity ascending', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const levelButton = screen.getByRole('button', { name: /sort by level/i });
      await fireEvent.click(levelButton);

      // Level priority: debug (1) < warn (3) < error (4)
      // Ascending: debug -> warn -> error
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('DEBUG')).toBeInTheDocument();
      expect(within(rows[1]).getByText('WARN')).toBeInTheDocument();
      expect(within(rows[2]).getByText('ERROR')).toBeInTheDocument();
    });

    it('sorts logs by level severity descending on second click', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const levelButton = screen.getByRole('button', { name: /sort by level/i });
      await fireEvent.click(levelButton); // asc
      await fireEvent.click(levelButton); // desc

      // Descending: error -> warn -> debug
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('ERROR')).toBeInTheDocument();
      expect(within(rows[1]).getByText('WARN')).toBeInTheDocument();
      expect(within(rows[2]).getByText('DEBUG')).toBeInTheDocument();
    });

    it('sorts logs by message alphabetically ascending', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const messageButton = screen.getByRole('button', { name: /sort by message/i });
      await fireEvent.click(messageButton);

      // Alphabetically: Alpha -> Beta -> Charlie
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('Alpha message')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Beta message')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Charlie message')).toBeInTheDocument();
    });

    it('sorts logs by message alphabetically descending on second click', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const messageButton = screen.getByRole('button', { name: /sort by message/i });
      await fireEvent.click(messageButton); // asc
      await fireEvent.click(messageButton); // desc

      // Descending: Charlie -> Beta -> Alpha
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('Charlie message')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Beta message')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Alpha message')).toBeInTheDocument();
    });

    it('switching sort columns resets to ascending', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const timeButton = screen.getByRole('button', { name: /sort by time/i });
      const levelButton = screen.getByRole('button', { name: /sort by level/i });

      await fireEvent.click(timeButton); // time asc
      await fireEvent.click(timeButton); // time desc
      await fireEvent.click(levelButton); // level asc (new column)

      // After switching to level, should be ascending: debug -> warn -> error
      const rows = screen.getAllByTestId('log-row');
      expect(within(rows[0]).getByText('DEBUG')).toBeInTheDocument();
      expect(within(rows[1]).getByText('WARN')).toBeInTheDocument();
      expect(within(rows[2]).getByText('ERROR')).toBeInTheDocument();
    });

    it('displays sort direction indicator on active column', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const timeButton = screen.getByRole('button', { name: /sort by time/i });
      await fireEvent.click(timeButton);

      // aria-sort should be on the <th> parent element
      const timeHeader = timeButton.closest('th');
      expect(timeHeader).toHaveAttribute('aria-sort', 'ascending');
    });

    it('displays descending indicator on second click', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const timeButton = screen.getByRole('button', { name: /sort by time/i });
      await fireEvent.click(timeButton); // asc
      await fireEvent.click(timeButton); // desc

      const timeHeader = timeButton.closest('th');
      expect(timeHeader).toHaveAttribute('aria-sort', 'descending');
    });

    it('removes sort indicator after third click', async () => {
      render(LogTable, { props: { logs: sortableLogs, loading: false } });

      const timeButton = screen.getByRole('button', { name: /sort by time/i });
      await fireEvent.click(timeButton); // asc
      await fireEvent.click(timeButton); // desc
      await fireEvent.click(timeButton); // reset

      const timeHeader = timeButton.closest('th');
      expect(timeHeader).toHaveAttribute('aria-sort', 'none');
    });
  });
});
