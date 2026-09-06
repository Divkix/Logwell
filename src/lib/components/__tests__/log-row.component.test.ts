import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Log } from "$lib/server/db/schema";
import LogRow from "../log-row.svelte";

vi.mock("$lib/utils/format", () => ({
  formatTimestamp: vi.fn((date: Date) => {
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    const seconds = date.getUTCSeconds().toString().padStart(2, "0");
    const milliseconds = date.getUTCMilliseconds().toString().padStart(3, "0");
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }),
}));

describe("LogRow", () => {
  const baseLog: Log = {
    id: "log_123",
    projectId: "proj_456",
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "User logged in successfully",
    metadata: { userId: "user_789" },
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
    sourceFile: "auth.ts",
    lineNumber: 42,
    requestId: "req_abc",
    userId: "user_789",
    ipAddress: "192.168.1.1",
    timestamp: new Date("2024-01-15T14:30:45.123Z"),
    search: "",
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ["2024-01-15T14:30:45.123Z", "14:30:45.123"],
    ["2024-06-20T08:15:30.456Z", "08:15:30.456"],
    ["2024-01-01T00:00:00.000Z", "00:00:00.000"],
  ])("renders timestamp %s as %s", (iso, expected) => {
    render(LogRow, { props: { log: { ...baseLog, timestamp: new Date(iso) } } });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders row without timestamp text when timestamp is null", () => {
    render(LogRow, { props: { log: { ...baseLog, timestamp: null as unknown as Date } } });
    expect(screen.getByTestId("log-timestamp-desktop")).toBeInTheDocument();
  });

  it.each([
    ["debug", "DEBUG"],
    ["info", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"],
    ["fatal", "FATAL"],
  ] as const)("renders %s level badge as %s", (level, label) => {
    render(LogRow, { props: { log: { ...baseLog, level } } });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("displays short messages in full and truncates long ones", () => {
    render(LogRow, { props: { log: baseLog } });
    expect(screen.getByText("User logged in successfully")).toBeInTheDocument();

    cleanup();
    const longMessage =
      "This is a very long log message that should be truncated because it exceeds the maximum display length for a log row in the table view";
    render(LogRow, { props: { log: { ...baseLog, message: longMessage } } });
    expect(screen.getByTestId("log-message-desktop")).toHaveClass("truncate");
  });

  it("calls onclick with the log when row is clicked", async () => {
    const onclick = vi.fn();
    render(LogRow, { props: { log: baseLog, onclick } });
    await fireEvent.click(screen.getByTestId("log-row"));
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(onclick).toHaveBeenCalledWith(baseLog);
  });

  it("does not throw on click when onclick is not provided", async () => {
    render(LogRow, { props: { log: baseLog } });
    await expect(fireEvent.click(screen.getByTestId("log-row"))).resolves.not.toThrow();
  });

  it("row is keyboard-focusable", () => {
    render(LogRow, { props: { log: baseLog } });
    expect(screen.getByTestId("log-row")).toHaveAttribute("tabindex", "0");
  });

  it.each(["Enter", " "] as const)("triggers onclick on %s key press", async (key) => {
    const onclick = vi.fn();
    render(LogRow, { props: { log: baseLog, onclick } });
    await fireEvent.keyDown(screen.getByTestId("log-row"), { key });
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(onclick).toHaveBeenCalledWith(baseLog);
  });

  it.each([
    [{ sourceFile: "auth.ts", lineNumber: 42 }, "auth.ts:42", true],
    [{ sourceFile: null, lineNumber: null }, "auth.ts", false],
    [{ sourceFile: "auth.ts", lineNumber: null }, "auth.ts", true],
  ] as const)("source info %#", (overrides, text, present) => {
    render(LogRow, { props: { log: { ...baseLog, ...overrides } } });
    if (present) {
      expect(screen.getByText(text)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/auth\.ts/)).not.toBeInTheDocument();
    }
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])("isNew=%s applies log-new class: %s", (isNew, expected) => {
    render(LogRow, { props: { log: baseLog, isNew } });
    const row = screen.getByTestId("log-row");
    if (expected) {
      expect(row).toHaveClass("log-new");
    } else {
      expect(row).not.toHaveClass("log-new");
    }
  });

  it("marks selected row for keyboard navigation", () => {
    render(LogRow, { props: { log: baseLog, isSelected: true } });
    const row = screen.getByTestId("log-row");
    expect(row).toHaveAttribute("data-selected", "true");
    expect(row).toHaveAttribute("aria-current", "true");
  });

  it("unselected row carries no current marker", () => {
    render(LogRow, { props: { log: baseLog } });
    const row = screen.getByTestId("log-row");
    expect(row).toHaveAttribute("data-selected", "false");
    expect(row).not.toHaveAttribute("aria-current");
  });
});
