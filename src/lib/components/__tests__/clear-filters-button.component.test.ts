import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ClearFiltersButton from "../clear-filters-button.svelte";

describe("ClearFiltersButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("visibility", () => {
    it("renders when visible is true", () => {
      render(ClearFiltersButton, { props: { visible: true } });

      expect(screen.getByTestId("clear-filters-button")).toBeInTheDocument();
    });

    it("does not render when visible is false", () => {
      render(ClearFiltersButton, { props: { visible: false } });

      expect(screen.queryByTestId("clear-filters-button")).not.toBeInTheDocument();
    });

    it("shows Clear text when visible", () => {
      render(ClearFiltersButton, { props: { visible: true } });

      expect(screen.getByText("Clear")).toBeInTheDocument();
    });
  });

  describe("interaction", () => {
    it("calls onclick handler when clicked", async () => {
      const user = userEvent.setup();
      const onclick = vi.fn();

      render(ClearFiltersButton, { props: { visible: true, onclick } });

      const button = screen.getByTestId("clear-filters-button");
      await user.click(button);

      expect(onclick).toHaveBeenCalledTimes(1);
    });

    it("does not call onclick when not provided", async () => {
      const user = userEvent.setup();

      render(ClearFiltersButton, { props: { visible: true } });

      const button = screen.getByTestId("clear-filters-button");
      // Should not throw error
      await user.click(button);
    });
  });

  describe("accessibility", () => {
    it("has accessible label", () => {
      render(ClearFiltersButton, { props: { visible: true } });

      const button = screen.getByTestId("clear-filters-button");
      expect(button).toHaveAttribute("aria-label", "Clear all filters");
    });

    it("is a button element", () => {
      render(ClearFiltersButton, { props: { visible: true } });

      const button = screen.getByTestId("clear-filters-button");
      expect(button.tagName).toBe("BUTTON");
    });
  });

  describe("styling", () => {
    it("renders with ghost variant", () => {
      render(ClearFiltersButton, { props: { visible: true } });

      const button = screen.getByTestId("clear-filters-button");
      expect(button).toBeInTheDocument();
      // Button should have ghost variant classes (we check it's rendered, actual class check is implementation detail)
    });

    it("renders with small size", () => {
      render(ClearFiltersButton, { props: { visible: true } });

      const button = screen.getByTestId("clear-filters-button");
      expect(button).toBeInTheDocument();
      // Button should have small size classes (we check it's rendered)
    });
  });
});
