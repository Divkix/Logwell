import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { IncidentDetail, IncidentTimelineResponse } from '$lib/shared/types';
import IncidentTimelinePanel from '../incident-timeline-panel.svelte';

const detail: IncidentDetail = {
  id: 'inc-1',
  projectId: 'proj-1',
  fingerprint: 'fp-1',
  title: 'Database timeout',
  normalizedMessage: 'database timeout {num}',
  serviceName: 'api',
  sourceFile: 'src/db.ts',
  lineNumber: 42,
  highestLevel: 'error',
  firstSeen: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
  totalEvents: 5,
  reopenCount: 1,
  status: 'open',
  rootCauseCandidates: [{ sourceFile: 'src/db.ts', lineNumber: 42, count: 5 }],
  correlations: {
    topRequestIds: [{ requestId: 'req-1', count: 2 }],
    topTraceIds: [{ traceId: 'trace-1', count: 2 }],
  },
};

const timeline: IncidentTimelineResponse = {
  incidentId: 'inc-1',
  range: '1h',
  buckets: [
    { timestamp: new Date().toISOString(), count: 3 },
    { timestamp: new Date().toISOString(), count: 1 },
  ],
  peakBucket: { timestamp: new Date().toISOString(), count: 3 },
};

describe('IncidentTimelinePanel', () => {
  it('shows empty state when no detail selected', () => {
    render(IncidentTimelinePanel, { props: { detail: null, timeline: null } });
    expect(screen.getByText(/select an incident/i)).toBeInTheDocument();
  });

  it('renders incident detail and correlation sections', () => {
    render(IncidentTimelinePanel, { props: { detail, timeline } });
    expect(screen.getByText('Incident Timeline')).toBeInTheDocument();
    expect(screen.getByText('Root-Cause Candidates')).toBeInTheDocument();
    expect(screen.getByText('Correlated Request IDs')).toBeInTheDocument();
  });
});
