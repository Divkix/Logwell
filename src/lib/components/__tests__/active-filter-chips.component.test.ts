import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ActiveFilterChips from "../active-filter-chips.svelte";

describe("ActiveFilterChips", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no filters are active", () => {
    render(ActiveFilterChips, { props: { levels: [], search: "", range: "1h" } });
    expect(screen.queryByTestId("active-filter-chips")).not.toBeInTheDocument();
  });

  it("renders level chips for selected levels", () => {
    render(ActiveFilterChips, { props: { levels: ["error", "warn"], search: "", range: "1h" } });
    expect(screen.getByTestId("filter-chip-level-error")).toBeInTheDocument();
    expect(screen.getByTestId("filter-chip-level-warn")).toBeInTheDocument();
  });

  it("renders search chip when search is set", () => {
    render(ActiveFilterChips, { props: { levels: [], search: "test query", range: "1h" } });
    expect(screen.getByTestId("filter-chip-search")).toBeInTheDocument();
    expect(screen.getByText(/"test query"/)).toBeInTheDocument();
  });

  it("renders range chip when range differs from default", () => {
    render(ActiveFilterChips, { props: { levels: [], search: "", range: "24h" } });
    expect(screen.getByTestId("filter-chip-range")).toBeInTheDocument();
    expect(screen.getByText("24h")).toBeInTheDocument();
  });

  it("does not render range chip when range equals default", () => {
    render(ActiveFilterChips, {
      props: { levels: [], search: "", range: "1h", defaultRange: "1h" },
    });
    expect(screen.queryByTestId("filter-chip-range")).not.toBeInTheDocument();
  });

  it("calls onRemoveLevel when level chip is clicked", async () => {
    const onRemoveLevel = vi.fn();
    render(ActiveFilterChips, {
      props: { levels: ["error"], search: "", range: "1h", onRemoveLevel },
    });
    await screen.getByTestId("filter-chip-level-error").click();
    expect(onRemoveLevel).toHaveBeenCalledWith("error");
  });

  it("calls onRemoveSearch when search chip is clicked", async () => {
    const onRemoveSearch = vi.fn();
    render(ActiveFilterChips, {
      props: { levels: [], search: "test", range: "1h", onRemoveSearch },
    });
    await screen.getByTestId("filter-chip-search").click();
    expect(onRemoveSearch).toHaveBeenCalled();
  });

  it("calls onRemoveRange when range chip is clicked", async () => {
    const onRemoveRange = vi.fn();
    render(ActiveFilterChips, { props: { levels: [], search: "", range: "24h", onRemoveRange } });
    await screen.getByTestId("filter-chip-range").click();
    expect(onRemoveRange).toHaveBeenCalled();
  });

  it("has accessible labels on all chips", () => {
    render(ActiveFilterChips, { props: { levels: ["error"], search: "test", range: "24h" } });
    expect(screen.getByLabelText(/remove error filter/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remove search filter/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remove time range filter/i)).toBeInTheDocument();
  });
});
