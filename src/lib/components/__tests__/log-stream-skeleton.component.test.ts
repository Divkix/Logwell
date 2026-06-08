import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import LogStreamSkeleton from "../log-stream-skeleton.svelte";

describe("LogStreamSkeleton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("structure and layout", () => {
    it("renders skeleton container", () => {
      render(LogStreamSkeleton);

      expect(screen.getByTestId("log-stream-skeleton")).toBeInTheDocument();
    });

    it("renders header skeleton", () => {
      render(LogStreamSkeleton);

      expect(screen.getByTestId("log-stream-skeleton-header")).toBeInTheDocument();
    });

    it("renders filters bar skeleton", () => {
      render(LogStreamSkeleton);

      expect(screen.getByTestId("log-stream-skeleton-filters")).toBeInTheDocument();
    });

    it("renders table skeleton", () => {
      render(LogStreamSkeleton);

      expect(screen.getByTestId("log-stream-skeleton-table")).toBeInTheDocument();
    });
  });

  describe("table skeleton rows", () => {
    it("renders multiple skeleton rows", () => {
      render(LogStreamSkeleton);

      const rows = screen.getAllByTestId("log-stream-skeleton-row");
      expect(rows.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("accessibility and animation", () => {
    it("container has proper spacing", () => {
      render(LogStreamSkeleton);

      const container = screen.getByTestId("log-stream-skeleton");
      expect(container).toHaveClass("space-y-6");
    });
  });
});
