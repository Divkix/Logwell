import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import LiveToggle from "../live-toggle.svelte";

describe("LiveToggle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("shows green pulse when enabled", () => {
    it("shows pulse indicator when enabled is true", () => {
      render(LiveToggle, { props: { enabled: true } });

      const pulse = screen.getByTestId("live-pulse");
      expect(pulse).toBeInTheDocument();
      expect(pulse).toHaveClass("bg-green-500");
    });

    it("shows animate-pulse class when enabled", () => {
      render(LiveToggle, { props: { enabled: true } });

      const pulse = screen.getByTestId("live-pulse");
      expect(pulse).toHaveClass("animate-pulse");
    });

    it("does not show pulse animation when disabled", () => {
      render(LiveToggle, { props: { enabled: false } });

      const pulse = screen.getByTestId("live-pulse");
      expect(pulse).not.toHaveClass("animate-pulse");
      expect(pulse).not.toHaveClass("bg-green-500");
    });

    it("shows muted color when disabled", () => {
      render(LiveToggle, { props: { enabled: false } });

      const pulse = screen.getByTestId("live-pulse");
      expect(pulse).toHaveClass("bg-muted-foreground");
    });
  });

  describe("toggles state on click", () => {
    it("renders a switch element", () => {
      render(LiveToggle);

      const toggle = screen.getByRole("switch");
      expect(toggle).toBeInTheDocument();
    });

    it("switch is checked when enabled is true", () => {
      render(LiveToggle, { props: { enabled: true } });

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("data-state", "checked");
    });

    it("switch is unchecked when enabled is false", () => {
      render(LiveToggle, { props: { enabled: false } });

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("data-state", "unchecked");
    });

    it("defaults to enabled when no prop provided", () => {
      render(LiveToggle);

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("data-state", "checked");
    });
  });

  describe("emits change event", () => {
    it("calls onchange with false when toggling off", async () => {
      const onchange = vi.fn();
      render(LiveToggle, { props: { enabled: true, onchange } });

      const toggle = screen.getByRole("switch");
      await fireEvent.click(toggle);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange).toHaveBeenCalledWith(false);
    });

    it("calls onchange with true when toggling on", async () => {
      const onchange = vi.fn();
      render(LiveToggle, { props: { enabled: false, onchange } });

      const toggle = screen.getByRole("switch");
      await fireEvent.click(toggle);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange).toHaveBeenCalledWith(true);
    });

    it("does not throw when onchange is not provided", async () => {
      render(LiveToggle, { props: { enabled: true } });

      const toggle = screen.getByRole("switch");

      await expect(fireEvent.click(toggle)).resolves.not.toThrow();
    });
  });

  describe("displays label", () => {
    it('shows "Live" label', () => {
      render(LiveToggle);

      expect(screen.getByText("Live")).toBeInTheDocument();
    });

    it("has accessible label for the switch", () => {
      render(LiveToggle);

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("aria-label", "Toggle live streaming");
    });
  });

  it("can be disabled", () => {
    render(LiveToggle, { props: { disabled: true } });

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
  });
});
