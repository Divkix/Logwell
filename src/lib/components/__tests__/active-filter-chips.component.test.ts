import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ActiveFilterChips from "../active-filter-chips.svelte";
import ClearFiltersButton from "../clear-filters-button.svelte";

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

  it.each([
    ["level", "filter-chip-level-error", "onRemoveLevel", ["error"], "", "1h", "error"],
    ["search", "filter-chip-search", "onRemoveSearch", [], "test", "1h", undefined],
    ["range", "filter-chip-range", "onRemoveRange", [], "", "24h", undefined],
  ] as const)(
    "calls %s remove callback when its chip is clicked",
    async (_kind, testId, prop, levels, search, range, expected) => {
      const callback = vi.fn();
      render(ActiveFilterChips, {
        props: { levels: [...levels], search, range, [prop]: callback },
      });
      screen.getByTestId(testId).click();
      if (expected === undefined) {
        expect(callback).toHaveBeenCalled();
      } else {
        expect(callback).toHaveBeenCalledWith(expected);
      }
    },
  );

  it("shows a working clear-all button (canonical clear-filters home)", async () => {
    const onclick = vi.fn();
    const { rerender } = render(ClearFiltersButton, { props: { visible: false, onclick } });
    expect(screen.queryByTestId("clear-filters-button")).not.toBeInTheDocument();

    await rerender({ visible: true, onclick });
    screen.getByTestId("clear-filters-button").click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it("has accessible labels on all chips", () => {
    render(ActiveFilterChips, { props: { levels: ["error"], search: "test", range: "24h" } });
    expect(screen.getByLabelText(/remove error filter/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remove search filter/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remove time range filter/i)).toBeInTheDocument();
  });
});
