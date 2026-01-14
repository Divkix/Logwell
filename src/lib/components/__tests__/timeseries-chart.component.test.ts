import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TimeseriesChart from '../timeseries-chart.svelte';

// Mock the browser environment check
vi.mock('$app/environment', () => ({
  browser: false, // Set to false for testing non-browser states
}));

const mockData = [
  { timestamp: '2024-01-15T10:00:00.000Z', count: 10 },
  { timestamp: '2024-01-15T11:00:00.000Z', count: 25 },
  { timestamp: '2024-01-15T12:00:00.000Z', count: 15 },
];

describe('TimeseriesChart', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Container Rendering', () => {
    it('renders container with data-testid="timeseries-chart"', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '24h' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });

    it('has accessible aria-label', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '24h' } });
      const chart = screen.getByTestId('timeseries-chart');
      expect(chart).toHaveAttribute(
        'aria-label',
        'Time series chart showing log volume over time',
      );
    });

    it('has role="figure"', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '24h' } });
      const chart = screen.getByTestId('timeseries-chart');
      expect(chart).toHaveAttribute('role', 'figure');
    });

    it('applies custom class when provided', () => {
      render(TimeseriesChart, {
        props: { data: mockData, range: '24h', class: 'custom-class' },
      });
      expect(screen.getByTestId('timeseries-chart')).toHaveClass('custom-class');
    });
  });

  describe('Loading State', () => {
    it('shows skeleton placeholder when loading=true', () => {
      render(TimeseriesChart, {
        props: { data: [], range: '24h', loading: true },
      });
      expect(screen.getByTestId('timeseries-skeleton')).toBeInTheDocument();
    });

    it('skeleton has animate-pulse class', () => {
      render(TimeseriesChart, {
        props: { data: [], range: '24h', loading: true },
      });
      expect(screen.getByTestId('timeseries-skeleton')).toHaveClass('animate-pulse');
    });

    it('does not show empty state when loading', () => {
      render(TimeseriesChart, {
        props: { data: [], range: '24h', loading: true },
      });
      expect(screen.queryByTestId('timeseries-empty')).not.toBeInTheDocument();
    });

    it('does not show error state when loading', () => {
      render(TimeseriesChart, {
        props: { data: [], range: '24h', loading: true, error: 'Some error' },
      });
      // Loading takes precedence
      expect(screen.getByTestId('timeseries-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('timeseries-error')).not.toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('shows error message when error prop is provided', () => {
      render(TimeseriesChart, {
        props: { data: [], range: '24h', error: 'Failed to load data' },
      });
      expect(screen.getByTestId('timeseries-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load data')).toBeInTheDocument();
    });

    it('does not show skeleton when error is present', () => {
      render(TimeseriesChart, {
        props: { data: [], range: '24h', error: 'Some error' },
      });
      expect(screen.queryByTestId('timeseries-skeleton')).not.toBeInTheDocument();
    });

    it('does not show empty state when error is present', () => {
      render(TimeseriesChart, {
        props: { data: [], range: '24h', error: 'Some error' },
      });
      expect(screen.queryByTestId('timeseries-empty')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty state message when data is empty array', () => {
      render(TimeseriesChart, { props: { data: [], range: '24h' } });
      expect(screen.getByTestId('timeseries-empty')).toBeInTheDocument();
      expect(
        screen.getByText('No data available for this time range'),
      ).toBeInTheDocument();
    });

    it('does not show skeleton when empty', () => {
      render(TimeseriesChart, { props: { data: [], range: '24h' } });
      expect(screen.queryByTestId('timeseries-skeleton')).not.toBeInTheDocument();
    });

    it('does not show error when empty', () => {
      render(TimeseriesChart, { props: { data: [], range: '24h' } });
      expect(screen.queryByTestId('timeseries-error')).not.toBeInTheDocument();
    });
  });

  describe('Chart Rendering (non-browser)', () => {
    // Since we mocked browser to false, the chart won't render
    // but the container should still be there without skeleton/empty/error
    it('does not render chart in non-browser environment', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '24h' } });

      // Container exists
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();

      // Chart is not rendered (browser check fails)
      expect(screen.queryByTestId('timeseries-chart-rendered')).not.toBeInTheDocument();

      // No error/loading/empty states shown either
      expect(screen.queryByTestId('timeseries-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeseries-empty')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeseries-error')).not.toBeInTheDocument();
    });
  });

  describe('Different Time Ranges', () => {
    it('accepts 15m range', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '15m' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });

    it('accepts 1h range', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '1h' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });

    it('accepts 24h range', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '24h' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });

    it('accepts 7d range', () => {
      render(TimeseriesChart, { props: { data: mockData, range: '7d' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });
  });

  describe('Data Handling', () => {
    it('handles large counts in data', () => {
      const largeData = [
        { timestamp: '2024-01-15T10:00:00.000Z', count: 1000000 },
        { timestamp: '2024-01-15T11:00:00.000Z', count: 2500000 },
      ];
      render(TimeseriesChart, { props: { data: largeData, range: '24h' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });

    it('handles all zero counts', () => {
      const zeroData = [
        { timestamp: '2024-01-15T10:00:00.000Z', count: 0 },
        { timestamp: '2024-01-15T11:00:00.000Z', count: 0 },
        { timestamp: '2024-01-15T12:00:00.000Z', count: 0 },
      ];
      render(TimeseriesChart, { props: { data: zeroData, range: '24h' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });

    it('handles single data point', () => {
      const singleData = [{ timestamp: '2024-01-15T10:00:00.000Z', count: 42 }];
      render(TimeseriesChart, { props: { data: singleData, range: '24h' } });
      expect(screen.getByTestId('timeseries-chart')).toBeInTheDocument();
    });
  });
});
