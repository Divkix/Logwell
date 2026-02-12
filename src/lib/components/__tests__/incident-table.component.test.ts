import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { IncidentListItem } from '$lib/shared/types';
import IncidentTable from '../incident-table.svelte';

function sampleIncident(overrides: Partial<IncidentListItem> = {}): IncidentListItem {
  return {
    id: 'inc-1',
    projectId: 'proj-1',
    fingerprint: 'fp-1',
    title: 'Database timeout after 1000ms',
    normalizedMessage: 'database timeout after {num}ms',
    serviceName: 'api',
    sourceFile: 'src/db.ts',
    lineNumber: 42,
    highestLevel: 'error',
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    totalEvents: 3,
    reopenCount: 0,
    status: 'open',
    ...overrides,
  };
}

describe('IncidentTable', () => {
  it('renders incident rows', () => {
    render(IncidentTable, { props: { incidents: [sampleIncident()] } });
    expect(screen.getAllByText(/database timeout/i).length).toBeGreaterThan(0);
  });

  it('calls onSelect when row/card clicked', async () => {
    const onSelect = vi.fn();
    render(IncidentTable, { props: { incidents: [sampleIncident()], onSelect } });

    const interactive = screen.queryByTestId('incident-row') ?? screen.getByTestId('incident-card');
    await fireEvent.click(interactive);

    expect(onSelect).toHaveBeenCalledWith('inc-1');
  });
});
