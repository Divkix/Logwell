import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import IncidentStatusBadge from '../incident-status-badge.svelte';

describe('IncidentStatusBadge', () => {
  it('renders open label', () => {
    render(IncidentStatusBadge, { props: { status: 'open' } });
    expect(screen.getByText('OPEN')).toBeInTheDocument();
  });

  it('renders resolved label', () => {
    render(IncidentStatusBadge, { props: { status: 'resolved' } });
    expect(screen.getByText('RESOLVED')).toBeInTheDocument();
  });
});
