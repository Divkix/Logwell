import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import TimeseriesChart from "../timeseries-chart.svelte";

vi.mock("$app/environment", () => ({
  browser: false,
}));

const mockData = [
  { timestamp: "2024-01-15T10:00:00.000Z", count: 10 },
  { timestamp: "2024-01-15T11:00:00.000Z", count: 25 },
  { timestamp: "2024-01-15T12:00:00.000Z", count: 15 },
];

describe("TimeseriesChart", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders accessible chart container", () => {
    render(TimeseriesChart, { props: { data: mockData, range: "24h" } });
    const chart = screen.getByTestId("timeseries-chart");
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveAttribute("aria-label", "Time series chart showing log volume over time");
    expect(chart).toHaveAttribute("role", "figure");
  });

  it.each(["loading", "error", "empty"] as const)(
    "state %s takes precedence correctly",
    (state) => {
      if (state === "loading") {
        render(TimeseriesChart, { props: { data: [], range: "24h", loading: true, error: "x" } });
        expect(screen.getByTestId("timeseries-skeleton")).toBeInTheDocument();
        expect(screen.queryByTestId("timeseries-error")).not.toBeInTheDocument();
        expect(screen.queryByTestId("timeseries-empty")).not.toBeInTheDocument();
      } else if (state === "error") {
        render(TimeseriesChart, {
          props: { data: [], range: "24h", error: "Failed to load data" },
        });
        expect(screen.getByTestId("timeseries-error")).toBeInTheDocument();
        expect(screen.getByText("Failed to load data")).toBeInTheDocument();
        expect(screen.queryByTestId("timeseries-skeleton")).not.toBeInTheDocument();
        expect(screen.queryByTestId("timeseries-empty")).not.toBeInTheDocument();
      } else {
        render(TimeseriesChart, { props: { data: [], range: "24h" } });
        expect(screen.getByTestId("timeseries-empty")).toBeInTheDocument();
        expect(screen.queryByTestId("timeseries-skeleton")).not.toBeInTheDocument();
        expect(screen.queryByTestId("timeseries-error")).not.toBeInTheDocument();
      }
    },
  );

  it("defers rendering to the browser environment", () => {
    render(TimeseriesChart, { props: { data: mockData, range: "24h" } });
    expect(screen.getByTestId("timeseries-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("timeseries-chart-rendered")).not.toBeInTheDocument();
  });

  it.each(["15m", "1h", "24h", "7d"] as const)("accepts %s range", (range) => {
    render(TimeseriesChart, { props: { data: mockData, range } });
    expect(screen.getByTestId("timeseries-chart")).toBeInTheDocument();
  });

  it("renders with sparse or extreme data", () => {
    render(TimeseriesChart, {
      props: { data: [{ timestamp: "2024-01-15T10:00:00.000Z", count: 1000000 }], range: "24h" },
    });
    expect(screen.getByTestId("timeseries-chart")).toBeInTheDocument();
    cleanup();
    render(TimeseriesChart, {
      props: {
        data: [
          { timestamp: "2024-01-15T10:00:00.000Z", count: 0 },
          { timestamp: "2024-01-15T11:00:00.000Z", count: 0 },
        ],
        range: "24h",
      },
    });
    expect(screen.getByTestId("timeseries-chart")).toBeInTheDocument();
  });
});
