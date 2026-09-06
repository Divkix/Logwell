import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Log } from "$lib/server/db/schema";
import LogTable from "../log-table.svelte";

vi.mock("$lib/utils/format", () => ({
  formatTimestamp: vi.fn((date: Date) => {
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    const seconds = date.getUTCSeconds().toString().padStart(2, "0");
    const milliseconds = date.getUTCMilliseconds().toString().padStart(3, "0");
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }),
}));

describe("LogTable", () => {
  const createLog = (overrides: Partial<Log> = {}): Log => ({
    id: "log_123",
    projectId: "proj_456",
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "Test log message",
    metadata: null,
    timeUnixNano: null,
    observedTimeUnixNano: null,
    severityNumber: null,
    severityText: null,
    body: null,
    droppedAttributesCount: null,
    flags: null,
    traceId: null,
    spanId: null,
    resourceAttributes: null,
    resourceDroppedAttributesCount: null,
    resourceSchemaUrl: null,
    scopeName: null,
    scopeVersion: null,
    scopeAttributes: null,
    scopeDroppedAttributesCount: null,
    scopeSchemaUrl: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: new Date("2024-01-15T14:30:45.123Z"),
    search: "",
    ...overrides,
  });

  const sampleLogs: Log[] = [
    createLog({ id: "log_1", message: "First log message", level: "info" }),
    createLog({
      id: "log_2",
      message: "Second log message",
      level: "error",
      timestamp: new Date("2024-01-15T14:31:00.000Z"),
    }),
    createLog({
      id: "log_3",
      message: "Third log message",
      level: "debug",
      timestamp: new Date("2024-01-15T14:32:00.000Z"),
    }),
  ];

  const sortableLogs: Log[] = [
    createLog({
      id: "log_a",
      message: "Alpha message",
      level: "error",
      timestamp: new Date("2024-01-15T14:30:00.000Z"),
    }),
    createLog({
      id: "log_b",
      message: "Beta message",
      level: "debug",
      timestamp: new Date("2024-01-15T14:32:00.000Z"),
    }),
    createLog({
      id: "log_c",
      message: "Charlie message",
      level: "warn",
      timestamp: new Date("2024-01-15T14:31:00.000Z"),
    }),
  ];

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders header and one row per log", () => {
    render(LogTable, { props: { logs: sampleLogs, loading: false } });
    expect(screen.getByTestId("log-table-header")).toBeInTheDocument();
    expect(screen.getAllByTestId("log-row")).toHaveLength(3);
    const table = screen.getByRole("table");
    expect(within(table).getByText("First log message")).toBeInTheDocument();
    expect(within(table).getByText("14:30:45.123")).toBeInTheDocument();
  });

  it("propagates onLogClick with the clicked log", async () => {
    const onLogClick = vi.fn();
    render(LogTable, { props: { logs: sampleLogs, loading: false, onLogClick } });
    screen.getAllByTestId("log-row")[0]!.click();
    expect(onLogClick).toHaveBeenCalledTimes(1);
    expect(onLogClick).toHaveBeenCalledWith(sampleLogs[0]);
  });

  it("shows loading skeletons instead of rows", () => {
    render(LogTable, { props: { logs: sampleLogs, loading: true } });
    expect(screen.getAllByTestId("log-table-skeleton-row").length).toBeGreaterThanOrEqual(5);
    expect(screen.queryAllByTestId("log-row")).toHaveLength(0);
    expect(screen.queryByTestId("log-table-empty")).not.toBeInTheDocument();
  });

  it.each([
    [{ hasFilters: false }, /no logs yet/i, "log-table-empty"],
    [{ hasFilters: true }, /no logs match your filters/i, "log-table-no-results"],
  ])("empty state with %o shows %s", (props, message, testId) => {
    render(LogTable, { props: { logs: [], loading: false, ...props } });
    expect(within(screen.getByRole("table")).getByText(message)).toBeInTheDocument();
    expect(screen.getAllByTestId(testId).length).toBeGreaterThan(0);
  });

  it("hides empty state when logs are present", () => {
    render(LogTable, { props: { logs: sampleLogs, loading: false } });
    expect(screen.queryByTestId("log-table-empty")).not.toBeInTheDocument();
  });

  it("renders sortable column headers", () => {
    render(LogTable, { props: { logs: sortableLogs, loading: false } });
    const header = screen.getByTestId("log-table-header");
    expect(within(header).getByRole("button", { name: /sort by time/i })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: /sort by level/i })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: /sort by message/i })).toBeInTheDocument();
  });

  it.each([
    ["time", ["Alpha message", "Charlie message", "Beta message"]],
    ["level", ["Beta message", "Charlie message", "Alpha message"]],
    ["message", ["Alpha message", "Beta message", "Charlie message"]],
  ] as const)("sorts ascending by %s on first click", async (column, expected) => {
    render(LogTable, { props: { logs: sortableLogs, loading: false } });
    await fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`sort by ${column}`, "i") }),
    );
    const rows = screen.getAllByTestId("log-row");
    expect(rows.map((row) => within(row).getByTestId("log-message-desktop").textContent)).toEqual(
      expected,
    );
  });

  it("toggles time sort descending then resets on third click", async () => {
    render(LogTable, { props: { logs: sortableLogs, loading: false } });
    const timeButton = screen.getByRole("button", { name: /sort by time/i });
    const order = () => screen.getAllByTestId("log-row").map((row) => row.textContent);

    await fireEvent.click(timeButton);
    expect(timeButton.closest("th")).toHaveAttribute("aria-sort", "ascending");

    await fireEvent.click(timeButton);
    expect(timeButton.closest("th")).toHaveAttribute("aria-sort", "descending");
    const descFirst = order()[0];

    await fireEvent.click(timeButton);
    expect(timeButton.closest("th")).toHaveAttribute("aria-sort", "none");
    // Reset restores input order (Alpha first), distinct from descending (Beta first)
    expect(order()[0]).toContain("Alpha message");
    expect(descFirst).toContain("Beta message");
  });

  it("switching sort columns resets to ascending", async () => {
    render(LogTable, { props: { logs: sortableLogs, loading: false } });
    const timeButton = screen.getByRole("button", { name: /sort by time/i });
    const levelButton = screen.getByRole("button", { name: /sort by level/i });

    await fireEvent.click(timeButton);
    await fireEvent.click(timeButton);
    await fireEvent.click(levelButton);

    const rows = screen.getAllByTestId("log-row");
    expect(within(rows[0]!).getByText("DEBUG")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("WARN")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("ERROR")).toBeInTheDocument();
  });
});
