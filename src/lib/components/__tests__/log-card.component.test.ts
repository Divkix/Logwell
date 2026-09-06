import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Log } from "$lib/server/db/schema";
import LogCard from "../log-card.svelte";

vi.mock("$lib/utils/format", () => ({
  formatTimestamp: vi.fn(() => "14:30:45.123"),
}));

// Single smoke test for the mobile card path (the desktop table path is
// covered by the log-table suite and e2e). responsive.spec.ts stays deleted.
describe("LogCard", () => {
  const baseLog: Log = {
    id: "log_123",
    projectId: "proj_456",
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "User logged in successfully",
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
    sourceFile: "auth.ts",
    lineNumber: 42,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: new Date("2024-01-15T14:30:45.123Z"),
    search: "",
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a new selected card and calls onclick with the log", async () => {
    const onclick = vi.fn();
    render(LogCard, { props: { log: baseLog, isNew: true, isSelected: true, onclick } });

    const card = screen.getByTestId("log-card");
    expect(card).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("User logged in successfully")).toBeInTheDocument();

    await fireEvent.click(card);
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(onclick).toHaveBeenCalledWith(baseLog);
  });
});
