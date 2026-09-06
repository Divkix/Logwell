import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import LevelChart from "../level-chart.svelte";

describe("LevelChart", () => {
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

  it("renders a segment per level with data and total count", () => {
    render(LevelChart, { props: { data: mockData } });

    for (const level of ["debug", "info", "warn", "error", "fatal"]) {
      expect(screen.getByTestId(`chart-segment-${level}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("chart-total")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
  });

  it("omits segments and legend entries for zero-count levels", () => {
    const dataWithZeros = {
      levelCounts: { debug: 0, info: 100, warn: 0, error: 0, fatal: 0 },
      levelPercentages: { debug: 0, info: 100, warn: 0, error: 0, fatal: 0 },
    };
    render(LevelChart, { props: { data: dataWithZeros } });

    expect(screen.queryByTestId("chart-segment-debug")).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-segment-info")).toBeInTheDocument();
    expect(screen.queryByTestId("legend-item-debug")).not.toBeInTheDocument();
    expect(screen.getByTestId("legend-item-info")).toBeInTheDocument();
  });

  it("renders empty state when all counts are zero", () => {
    render(LevelChart, { props: { data: { levelCounts: {}, levelPercentages: {} } } });
    expect(screen.getByTestId("level-chart-empty")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it.each([
    ["debug", "DEBUG", "100", "25%"],
    ["info", "INFO", "200", "50%"],
    ["warn", "WARN", "50", "12.5%"],
    ["error", "ERROR", "30", "7.5%"],
    ["fatal", "FATAL", "20", "5%"],
  ])("legend entry %s shows %s with count %s and %s", (level, label, count, pct) => {
    render(LevelChart, { props: { data: mockData } });
    expect(screen.getByTestId(`legend-item-${level}`)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(count)).toBeInTheDocument();
    expect(screen.getByText(pct)).toBeInTheDocument();
  });

  it("formats fractional percentages", () => {
    render(LevelChart, {
      props: {
        data: {
          levelCounts: { info: 333, warn: 667 },
          levelPercentages: { info: 33.3, warn: 66.7 },
        },
      },
    });
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.getByText("66.7%")).toBeInTheDocument();
  });

  it("handles single-level data", () => {
    render(LevelChart, {
      props: { data: { levelCounts: { error: 100 }, levelPercentages: { error: 100 } } },
    });
    expect(screen.getByTestId("chart-segment-error")).toBeInTheDocument();
    expect(screen.getByTestId("chart-total")).toHaveTextContent("100");
    expect(screen.getByTestId("legend-item-error")).toHaveTextContent("100%");
  });
});
