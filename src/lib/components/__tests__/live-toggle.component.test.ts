import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import LiveToggle from "../live-toggle.svelte";

describe("LiveToggle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    [true, "bg-green-500", "animate-pulse"],
    [false, "bg-muted-foreground", null],
  ])("enabled=%s shows the matching pulse state", (enabled, expectedClass, pulseClass) => {
    render(LiveToggle, { props: { enabled } });
    const pulse = screen.getByTestId("live-pulse");
    expect(pulse).toHaveClass(expectedClass);
    if (pulseClass) {
      expect(pulse).toHaveClass(pulseClass);
    } else {
      expect(pulse).not.toHaveClass("animate-pulse");
    }
  });

  it("switch reflects enabled state and defaults to on", () => {
    render(LiveToggle, { props: { enabled: false } });
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked");
    cleanup();
    render(LiveToggle);
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "checked");
  });

  it.each([
    [true, false],
    [false, true],
  ])("clicking when enabled=%s emits onchange(%s)", async (enabled, expected) => {
    const onchange = vi.fn();
    render(LiveToggle, { props: { enabled, onchange } });
    await fireEvent.click(screen.getByRole("switch"));
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(onchange).toHaveBeenCalledWith(expected);
  });

  it("does not throw on click without a handler and renders its label", async () => {
    render(LiveToggle, { props: { enabled: true } });
    await expect(fireEvent.click(screen.getByRole("switch"))).resolves.not.toThrow();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });
});
