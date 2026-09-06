import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Log } from "$lib/server/db/schema";
import CreateProjectModal from "../create-project-modal.svelte";
import LogDetailModal from "../log-detail-modal.svelte";

const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.assign(navigator, { clipboard: mockClipboard });

vi.mock("$lib/utils/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("$lib/utils/format", () => ({
  formatFullDate: vi.fn((date: Date) => {
    return date.toISOString().replace("T", " ").replace("Z", " UTC");
  }),
}));

describe("Modal accessibility", () => {
  const baseLog: Log = {
    id: "log_123",
    projectId: "proj_456",
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "Test log message",
    metadata: { test: "data" },
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
    sourceFile: "test.ts",
    lineNumber: 10,
    requestId: "req_abc",
    userId: "user_123",
    ipAddress: "127.0.0.1",
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

  it.each([
    ["log detail", LogDetailModal, { log: baseLog, open: true }],
    ["create project", CreateProjectModal, { open: true }],
  ])("%s modal traps Tab focus within the dialog", async (_name, component, props) => {
    render(component as typeof LogDetailModal, { props: props as never });

    const modal = screen.getByRole("dialog");
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusableElements.length).toBeGreaterThan(0);

    const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;
    const firstFocusable = focusableElements[0] as HTMLElement;
    lastFocusable.focus();
    await fireEvent.keyDown(modal, { key: "Tab" });

    expect(firstFocusable).toBeInTheDocument();
    expect(lastFocusable).toBeInTheDocument();
  });

  it("log detail modal restores focus to the trigger on close", async () => {
    const triggerButton = document.createElement("button");
    triggerButton.textContent = "Open Modal";
    document.body.appendChild(triggerButton);
    triggerButton.focus();

    const { rerender } = render(LogDetailModal, {
      props: { log: baseLog, open: true, triggerElement: triggerButton },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rerender({ log: baseLog, open: false, triggerElement: triggerButton });

    await waitFor(
      () => {
        expect(document.activeElement).toBe(triggerButton);
      },
      { timeout: 500 },
    );

    document.body.removeChild(triggerButton);
  });

  it("interactive controls carry accessible names", () => {
    render(LogDetailModal, { props: { log: baseLog, open: true } });
    expect(screen.getByTestId("copy-id-button")).toHaveAttribute(
      "aria-label",
      "Copy log ID to clipboard",
    );
    expect(screen.getByTestId("close-button")).toHaveAttribute("aria-label", "Close log details");
    expect(screen.getByTestId("metadata-section")).toHaveAttribute("aria-label", "Log metadata");
  });

  it("announceToScreenReader creates an atomic live region", async () => {
    const { announceToScreenReader } = await import("$lib/utils/focus-trap");
    announceToScreenReader("Test announcement");

    await waitFor(
      () => {
        const liveRegion = document.getElementById("sr-announcer");
        expect(liveRegion).toBeInTheDocument();
        expect(liveRegion).toHaveAttribute("aria-live");
        expect(liveRegion).toHaveAttribute("aria-atomic", "true");
        expect(liveRegion).toHaveClass("sr-only");
      },
      { timeout: 100 },
    );

    document.getElementById("sr-announcer")?.remove();
  });
});
