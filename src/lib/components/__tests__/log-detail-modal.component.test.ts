import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Log } from "$lib/server/db/schema";
import LogDetailModal from "../log-detail-modal.svelte";

const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.assign(navigator, { clipboard: mockClipboard });

vi.mock("$lib/utils/format", () => ({
  formatFullDate: vi.fn((date: Date) => {
    return date.toISOString().replace("T", " ").replace("Z", " UTC");
  }),
}));

describe("LogDetailModal", () => {
  const baseLog: Log = {
    id: "log_123",
    projectId: "proj_456",
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "User logged in successfully",
    metadata: { userId: "user_789", action: "login", details: { ip: "192.168.1.1" } },
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the full log with formatted timestamp and metadata", () => {
    render(LogDetailModal, { props: { log: baseLog, open: true } });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("log_123")).toBeInTheDocument();
    expect(screen.getByText("INFO")).toBeInTheDocument();
    expect(screen.getByText("User logged in successfully")).toBeInTheDocument();
    expect(screen.getByText("auth.ts:42")).toBeInTheDocument();
    expect(screen.getByText("req_abc")).toBeInTheDocument();
    expect(screen.getByText(/2024-01-15 14:30:45\.123 UTC/)).toBeInTheDocument();

    const metadataElement = screen.getByTestId("log-metadata");
    expect(metadataElement.textContent).toContain('"userId"');
    expect(metadataElement.textContent).toContain('"details"');
  });

  it("shows N/A for missing fields and stays hidden when closed", () => {
    const sparse: Log = {
      ...baseLog,
      sourceFile: null,
      lineNumber: null,
      requestId: null,
      userId: null,
      ipAddress: null,
      metadata: null,
      timestamp: null as unknown as Date,
    };
    render(LogDetailModal, { props: { log: sparse, open: true } });
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(4);

    cleanup();
    render(LogDetailModal, { props: { log: baseLog, open: false } });
    expect(screen.queryByText("log_123")).not.toBeInTheDocument();
  });

  it.each([
    ["copy-id-button", "log_123"],
    ["copy-message-button", "User logged in successfully"],
    ["copy-request-id-button", "req_abc"],
  ])("%s copies its value to the clipboard", async (testId, expected) => {
    render(LogDetailModal, { props: { log: baseLog, open: true } });
    await fireEvent.click(screen.getByTestId(testId));
    expect(mockClipboard.writeText).toHaveBeenCalledWith(expected);
  });

  it("copies metadata as formatted JSON and hides the button when null", async () => {
    render(LogDetailModal, { props: { log: baseLog, open: true } });
    await fireEvent.click(screen.getByTestId("copy-metadata-button"));
    expect(mockClipboard.writeText).toHaveBeenCalledWith(JSON.stringify(baseLog.metadata, null, 2));

    cleanup();
    render(LogDetailModal, { props: { log: { ...baseLog, metadata: null }, open: true } });
    expect(screen.queryByTestId("copy-metadata-button")).not.toBeInTheDocument();
  });

  it.each(["overlay", "close-button", "Escape"])("close via %s calls onClose", async (method) => {
    const onClose = vi.fn();
    render(LogDetailModal, { props: { log: baseLog, open: true, onClose } });

    if (method === "overlay") {
      await fireEvent.click(screen.getByTestId("modal-overlay"));
    } else if (method === "close-button") {
      await fireEvent.click(screen.getByTestId("close-button"));
    } else {
      await fireEvent.keyDown(document, { key: "Escape" });
    }
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores content clicks and non-Escape keys", async () => {
    const onClose = vi.fn();
    render(LogDetailModal, { props: { log: baseLog, open: true, onClose } });
    await fireEvent.click(screen.getByTestId("modal-content"));
    await fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
