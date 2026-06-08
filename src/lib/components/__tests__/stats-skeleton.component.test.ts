import { cleanup, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import StatsSkeleton from "../stats-skeleton.svelte";

describe("StatsSkeleton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("structure and layout", () => {
    it("renders skeleton container", () => {
      render(StatsSkeleton);

      expect(screen.getByTestId("stats-skeleton")).toBeInTheDocument();
    });

    it("renders header skeleton section", () => {
      render(StatsSkeleton);

      expect(screen.getByTestId("stats-skeleton-header")).toBeInTheDocument();
    });

    it("renders stats header section with title and description", () => {
      render(StatsSkeleton);

      expect(screen.getByTestId("stats-skeleton-subheader")).toBeInTheDocument();
    });
  });

  describe("chart skeleton", () => {
    it("renders chart skeleton section", () => {
      render(StatsSkeleton);

      expect(screen.getByTestId("stats-skeleton-chart")).toBeInTheDocument();
    });

    it("renders donut chart placeholder with circular shape", () => {
      render(StatsSkeleton);

      const chartSection = screen.getByTestId("stats-skeleton-chart");
      const donut = within(chartSection).getByTestId("skeleton-donut");
      expect(donut).toHaveClass("rounded-full");
    });

    it("donut skeleton has correct dimensions (200x200)", () => {
      render(StatsSkeleton);

      const donut = screen.getByTestId("skeleton-donut");
      expect(donut).toHaveClass("h-[200px]");
      expect(donut).toHaveClass("w-[200px]");
    });
  });

  describe("legend skeleton", () => {
    it("renders legend skeleton section", () => {
      render(StatsSkeleton);

      expect(screen.getByTestId("stats-skeleton-legend")).toBeInTheDocument();
    });

    it("renders multiple legend item skeletons", () => {
      render(StatsSkeleton);

      const legendItems = screen.getAllByTestId("skeleton-legend-item");
      expect(legendItems.length).toBeGreaterThanOrEqual(3);
    });

    it("legend item has color placeholder", () => {
      render(StatsSkeleton);

      const legendItems = screen.getAllByTestId("skeleton-legend-item");
      expect(within(legendItems[0]!).getByTestId("skeleton-legend-color")).toBeInTheDocument();
    });

    it("legend item has text placeholder", () => {
      render(StatsSkeleton);

      const legendItems = screen.getAllByTestId("skeleton-legend-item");
      expect(within(legendItems[0]!).getByTestId("skeleton-legend-text")).toBeInTheDocument();
    });
  });

  describe("summary skeleton", () => {
    it("renders summary skeleton section", () => {
      render(StatsSkeleton);

      expect(screen.getByTestId("stats-skeleton-summary")).toBeInTheDocument();
    });

    it("summary section is centered", () => {
      render(StatsSkeleton);

      const summary = screen.getByTestId("stats-skeleton-summary");
      expect(summary).toHaveClass("text-center");
    });
  });

  describe("accessibility and animation", () => {
    it("chart skeleton has pulse animation", () => {
      render(StatsSkeleton);

      const donut = screen.getByTestId("skeleton-donut");
      expect(donut).toHaveClass("animate-pulse");
    });

    it("legend skeletons have pulse animation", () => {
      render(StatsSkeleton);

      const legendText = screen.getAllByTestId("skeleton-legend-text")[0];
      expect(legendText).toHaveClass("animate-pulse");
    });
  });

  describe("consistent dimensions", () => {
    it("container has same spacing as real stats page", () => {
      render(StatsSkeleton);

      const container = screen.getByTestId("stats-skeleton");
      expect(container).toHaveClass("space-y-6");
    });

    it("chart section has same padding as real page", () => {
      render(StatsSkeleton);

      const chartSection = screen.getByTestId("stats-skeleton-chart");
      expect(chartSection).toHaveClass("py-8");
    });
  });
});
