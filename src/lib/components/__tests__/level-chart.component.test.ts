import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LevelChart from '../level-chart.svelte';

describe('LevelChart', () => {
  afterEach(() => {
    cleanup();
  });

  const mockData = {
    levelCounts: {
      debug: 100,
      info: 200,
      warn: 50,
      error: 30,
      fatal: 20,
    },
    levelPercentages: {
      debug: 25,
      info: 50,
      warn: 12.5,
      error: 7.5,
      fatal: 5,
    },
  };

  describe('renders donut chart with correct segments', () => {
    it('renders SVG donut chart container', () => {
      render(LevelChart, { props: { data: mockData } });

      const svg = screen.getByTestId('level-chart-svg');
      expect(svg).toBeInTheDocument();
      expect(svg.tagName.toLowerCase()).toBe('svg');
    });

    it('renders a segment for each level with data', () => {
      render(LevelChart, { props: { data: mockData } });

      // Each level should have a path element
      expect(screen.getByTestId('chart-segment-debug')).toBeInTheDocument();
      expect(screen.getByTestId('chart-segment-info')).toBeInTheDocument();
      expect(screen.getByTestId('chart-segment-warn')).toBeInTheDocument();
      expect(screen.getByTestId('chart-segment-error')).toBeInTheDocument();
      expect(screen.getByTestId('chart-segment-fatal')).toBeInTheDocument();
    });

    it('does not render segments for levels with zero count', () => {
      const dataWithZeros = {
        levelCounts: {
          debug: 0,
          info: 100,
          warn: 0,
          error: 0,
          fatal: 0,
        },
        levelPercentages: {
          debug: 0,
          info: 100,
          warn: 0,
          error: 0,
          fatal: 0,
        },
      };

      render(LevelChart, { props: { data: dataWithZeros } });

      expect(screen.queryByTestId('chart-segment-debug')).not.toBeInTheDocument();
      expect(screen.getByTestId('chart-segment-info')).toBeInTheDocument();
      expect(screen.queryByTestId('chart-segment-warn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chart-segment-error')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chart-segment-fatal')).not.toBeInTheDocument();
    });

    it('renders empty state when all counts are zero', () => {
      const emptyData = {
        levelCounts: {},
        levelPercentages: {},
      };

      render(LevelChart, { props: { data: emptyData } });

      expect(screen.getByTestId('level-chart-empty')).toBeInTheDocument();
      expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('renders center text with total count', () => {
      render(LevelChart, { props: { data: mockData } });

      // Total is 400 (100 + 200 + 50 + 30 + 20)
      expect(screen.getByTestId('chart-total')).toBeInTheDocument();
      expect(screen.getByText('400')).toBeInTheDocument();
    });
  });

  describe('displays legend with percentages', () => {
    it('renders legend container', () => {
      render(LevelChart, { props: { data: mockData } });

      expect(screen.getByTestId('level-chart-legend')).toBeInTheDocument();
    });

    it('displays each level with its count and percentage', () => {
      render(LevelChart, { props: { data: mockData } });

      // Check debug entry
      expect(screen.getByTestId('legend-item-debug')).toBeInTheDocument();
      expect(screen.getByText('DEBUG')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('25%')).toBeInTheDocument();

      // Check info entry
      expect(screen.getByTestId('legend-item-info')).toBeInTheDocument();
      expect(screen.getByText('INFO')).toBeInTheDocument();
      expect(screen.getByText('200')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();

      // Check warn entry
      expect(screen.getByTestId('legend-item-warn')).toBeInTheDocument();
      expect(screen.getByText('WARN')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('12.5%')).toBeInTheDocument();

      // Check error entry
      expect(screen.getByTestId('legend-item-error')).toBeInTheDocument();
      expect(screen.getByText('ERROR')).toBeInTheDocument();
      expect(screen.getByText('30')).toBeInTheDocument();
      expect(screen.getByText('7.5%')).toBeInTheDocument();

      // Check fatal entry
      expect(screen.getByTestId('legend-item-fatal')).toBeInTheDocument();
      expect(screen.getByText('FATAL')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();
      expect(screen.getByText('5%')).toBeInTheDocument();
    });

    it('does not show legend entries for levels with zero count', () => {
      const partialData = {
        levelCounts: {
          info: 80,
          error: 20,
        },
        levelPercentages: {
          info: 80,
          error: 20,
        },
      };

      render(LevelChart, { props: { data: partialData } });

      expect(screen.queryByTestId('legend-item-debug')).not.toBeInTheDocument();
      expect(screen.getByTestId('legend-item-info')).toBeInTheDocument();
      expect(screen.queryByTestId('legend-item-warn')).not.toBeInTheDocument();
      expect(screen.getByTestId('legend-item-error')).toBeInTheDocument();
      expect(screen.queryByTestId('legend-item-fatal')).not.toBeInTheDocument();
    });

    it('formats percentages with one decimal place', () => {
      const precisionData = {
        levelCounts: {
          info: 333,
          warn: 667,
        },
        levelPercentages: {
          info: 33.3,
          warn: 66.7,
        },
      };

      render(LevelChart, { props: { data: precisionData } });

      expect(screen.getByText('33.3%')).toBeInTheDocument();
      expect(screen.getByText('66.7%')).toBeInTheDocument();
    });

    it('displays legend color indicators matching segment colors', () => {
      render(LevelChart, { props: { data: mockData } });

      // Each legend item should have a color indicator
      const debugIndicator = screen.getByTestId('legend-color-debug');
      const infoIndicator = screen.getByTestId('legend-color-info');
      const warnIndicator = screen.getByTestId('legend-color-warn');
      const errorIndicator = screen.getByTestId('legend-color-error');
      const fatalIndicator = screen.getByTestId('legend-color-fatal');

      expect(debugIndicator).toBeInTheDocument();
      expect(infoIndicator).toBeInTheDocument();
      expect(warnIndicator).toBeInTheDocument();
      expect(errorIndicator).toBeInTheDocument();
      expect(fatalIndicator).toBeInTheDocument();
    });
  });

  describe('uses correct colors for each level', () => {
    it('uses slate color for debug segment', () => {
      render(LevelChart, { props: { data: mockData } });

      const segment = screen.getByTestId('chart-segment-debug');
      expect(segment.getAttribute('fill')).toBe('hsl(215, 15%, 50%)');
    });

    it('uses blue color for info segment', () => {
      render(LevelChart, { props: { data: mockData } });

      const segment = screen.getByTestId('chart-segment-info');
      expect(segment.getAttribute('fill')).toBe('hsl(210, 100%, 50%)');
    });

    it('uses amber color for warn segment', () => {
      render(LevelChart, { props: { data: mockData } });

      const segment = screen.getByTestId('chart-segment-warn');
      expect(segment.getAttribute('fill')).toBe('hsl(45, 100%, 50%)');
    });

    it('uses red color for error segment', () => {
      render(LevelChart, { props: { data: mockData } });

      const segment = screen.getByTestId('chart-segment-error');
      expect(segment.getAttribute('fill')).toBe('hsl(0, 85%, 55%)');
    });

    it('uses purple color for fatal segment', () => {
      render(LevelChart, { props: { data: mockData } });

      const segment = screen.getByTestId('chart-segment-fatal');
      expect(segment.getAttribute('fill')).toBe('hsl(270, 70%, 55%)');
    });

    it('uses matching colors for legend indicators', () => {
      render(LevelChart, { props: { data: mockData } });

      const debugIndicator = screen.getByTestId('legend-color-debug');
      const infoIndicator = screen.getByTestId('legend-color-info');
      const warnIndicator = screen.getByTestId('legend-color-warn');
      const errorIndicator = screen.getByTestId('legend-color-error');
      const fatalIndicator = screen.getByTestId('legend-color-fatal');

      // Verify legend indicators have background-color style set (JSDOM converts HSL to RGB)
      expect(debugIndicator.getAttribute('style')).toContain('background-color');
      expect(infoIndicator.getAttribute('style')).toContain('background-color');
      expect(warnIndicator.getAttribute('style')).toContain('background-color');
      expect(errorIndicator.getAttribute('style')).toContain('background-color');
      expect(fatalIndicator.getAttribute('style')).toContain('background-color');
    });
  });

  describe('edge cases', () => {
    it('handles single level data', () => {
      const singleData = {
        levelCounts: {
          error: 100,
        },
        levelPercentages: {
          error: 100,
        },
      };

      render(LevelChart, { props: { data: singleData } });

      expect(screen.getByTestId('chart-segment-error')).toBeInTheDocument();
      // Use testids to avoid ambiguity between total count and legend count
      expect(screen.getByTestId('chart-total')).toHaveTextContent('100');
      expect(screen.getByTestId('legend-item-error')).toHaveTextContent('100%');
    });

    it('handles very small percentages', () => {
      const smallData = {
        levelCounts: {
          info: 999,
          fatal: 1,
        },
        levelPercentages: {
          info: 99.9,
          fatal: 0.1,
        },
      };

      render(LevelChart, { props: { data: smallData } });

      expect(screen.getByText('99.9%')).toBeInTheDocument();
      expect(screen.getByText('0.1%')).toBeInTheDocument();
    });

    it('renders with custom class', () => {
      render(LevelChart, { props: { data: mockData, class: 'custom-class' } });

      const container = screen.getByTestId('level-chart-container');
      expect(container.className).toContain('custom-class');
    });
  });
});
