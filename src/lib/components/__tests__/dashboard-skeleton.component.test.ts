import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DashboardSkeleton from '../dashboard-skeleton.svelte';

describe('DashboardSkeleton', () => {
  afterEach(() => {
    cleanup();
  });

  describe('structure and layout', () => {
    it('renders skeleton container', () => {
      render(DashboardSkeleton);

      expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    });

    it('renders header skeleton with title placeholder', () => {
      render(DashboardSkeleton);

      expect(screen.getByTestId('dashboard-skeleton-header')).toBeInTheDocument();
    });

    it('renders button skeleton in header', () => {
      render(DashboardSkeleton);

      const header = screen.getByTestId('dashboard-skeleton-header');
      expect(within(header).getByTestId('skeleton-button')).toBeInTheDocument();
    });
  });

  describe('project card skeletons', () => {
    it('renders skeleton cards grid', () => {
      render(DashboardSkeleton);

      expect(screen.getByTestId('dashboard-skeleton-grid')).toBeInTheDocument();
    });

    it('renders multiple project card skeletons', () => {
      render(DashboardSkeleton);

      const cards = screen.getAllByTestId('project-card-skeleton');
      expect(cards.length).toBeGreaterThanOrEqual(4);
    });

    it('card skeleton has title placeholder', () => {
      render(DashboardSkeleton);

      const cards = screen.getAllByTestId('project-card-skeleton');
      expect(within(cards[0]!).getByTestId('skeleton-title')).toBeInTheDocument();
    });

    it('card skeleton has content placeholders', () => {
      render(DashboardSkeleton);

      const cards = screen.getAllByTestId('project-card-skeleton');
      expect(within(cards[0]!).getByTestId('skeleton-content')).toBeInTheDocument();
    });

    it('card skeleton has button placeholder', () => {
      render(DashboardSkeleton);

      const cards = screen.getAllByTestId('project-card-skeleton');
      expect(within(cards[0]!).getByTestId('skeleton-card-button')).toBeInTheDocument();
    });
  });

  describe('accessibility and animation', () => {
    it('has pulse animation on skeleton elements', () => {
      render(DashboardSkeleton);

      const skeletonTitle = screen.getAllByTestId('skeleton-title')[0]!;
      expect(skeletonTitle).toHaveClass('animate-pulse');
    });

    it('renders skeleton with proper grid layout', () => {
      render(DashboardSkeleton);

      const grid = screen.getByTestId('dashboard-skeleton-grid');
      expect(grid).toHaveClass('grid');
    });
  });

  describe('consistent dimensions', () => {
    it('skeleton matches real component layout with same container classes', () => {
      render(DashboardSkeleton);

      const container = screen.getByTestId('dashboard-skeleton');
      expect(container).toHaveClass('space-y-6');
    });

    it('grid uses responsive columns matching dashboard', () => {
      render(DashboardSkeleton);

      const grid = screen.getByTestId('dashboard-skeleton-grid');
      expect(grid).toHaveClass('sm:grid-cols-2');
      expect(grid).toHaveClass('lg:grid-cols-3');
      expect(grid).toHaveClass('xl:grid-cols-4');
    });
  });
});
