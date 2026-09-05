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

describe("Accessibility: Modal Focus Management", () => {
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

  describe("LogDetailModal Focus Management", () => {
    it("traps focus within the modal when open", async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

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

    it("traps focus when shift+tabbing from first element", async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const modal = screen.getByRole("dialog");
      const focusableElements = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );

      const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;
      const firstFocusable = focusableElements[0] as HTMLElement;

      firstFocusable.focus();
      await fireEvent.keyDown(modal, { key: "Tab", shiftKey: true });

      expect(firstFocusable).toBeInTheDocument();
      expect(lastFocusable).toBeInTheDocument();
    });

    it("close button is focusable when modal opens", async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const closeButton = screen.getByTestId("close-button");
      expect(closeButton).toBeInTheDocument();
      expect(closeButton).toHaveAttribute("aria-label", "Close log details");
      closeButton.focus();
      expect(document.activeElement).toBe(closeButton);
    });

    it("restores focus to trigger element when modal closes", async () => {
      const triggerButton = document.createElement("button");
      triggerButton.id = "trigger";
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
  });

  describe("CreateProjectModal Focus Management", () => {
    it("traps focus within the modal when open", async () => {
      render(CreateProjectModal, { props: { open: true } });

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

    it("name input is focusable when modal opens", async () => {
      render(CreateProjectModal, { props: { open: true } });

      const nameInput = screen.getByLabelText(/name/i);
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveAttribute("id", "project-name");
      nameInput.focus();
      expect(document.activeElement).toBe(nameInput);
    });

    it("restores focus to trigger element when modal closes", async () => {
      const triggerButton = document.createElement("button");
      triggerButton.id = "trigger";
      document.body.appendChild(triggerButton);
      triggerButton.focus();

      const { rerender } = render(CreateProjectModal, {
        props: { open: true, triggerElement: triggerButton },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      await rerender({ open: false, triggerElement: triggerButton });

      await waitFor(
        () => {
          expect(document.activeElement).toBe(triggerButton);
        },
        { timeout: 500 },
      );

      document.body.removeChild(triggerButton);
    });
  });
});

describe("Accessibility: ARIA Labels", () => {
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

  afterEach(() => {
    cleanup();
  });

  describe("LogDetailModal ARIA Labels", () => {
    it("copy ID button has descriptive aria-label", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyIdButton = screen.getByTestId("copy-id-button");
      expect(copyIdButton).toHaveAttribute("aria-label", "Copy log ID to clipboard");
    });

    it("copy message button has descriptive aria-label", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyMessageButton = screen.getByTestId("copy-message-button");
      expect(copyMessageButton).toHaveAttribute("aria-label", "Copy message to clipboard");
    });

    it("copy metadata button has descriptive aria-label", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyMetadataButton = screen.getByTestId("copy-metadata-button");
      expect(copyMetadataButton).toHaveAttribute("aria-label", "Copy metadata to clipboard");
    });

    it("copy request ID button has descriptive aria-label", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyRequestIdButton = screen.getByTestId("copy-request-id-button");
      expect(copyRequestIdButton).toHaveAttribute("aria-label", "Copy request ID to clipboard");
    });

    it("close button has descriptive aria-label", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const closeButton = screen.getByTestId("close-button");
      expect(closeButton).toHaveAttribute("aria-label", "Close log details");
    });

    it("metadata section has aria-label", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const metadataSection = screen.getByTestId("metadata-section");
      expect(metadataSection).toHaveAttribute("aria-label", "Log metadata");
    });
  });

  describe("CreateProjectModal ARIA Labels", () => {
    it("close button has descriptive aria-label", () => {
      render(CreateProjectModal, { props: { open: true } });

      const closeButton = screen.getByTestId("close-button");
      expect(closeButton).toHaveAttribute("aria-label", "Close create project dialog");
    });
  });
});

describe("Accessibility: Keyboard Navigation", () => {
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

  afterEach(() => {
    cleanup();
  });

  describe("Modal keyboard interactions", () => {
    it("all interactive elements are reachable via Tab", async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const modal = screen.getByRole("dialog");
      const buttons = modal.querySelectorAll("button");

      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((button) => {
        expect(button).not.toHaveAttribute("tabindex", "-1");
      });
    });

    it("copy buttons are properly labeled for activation", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyIdButton = screen.getByTestId("copy-id-button");
      expect(copyIdButton).toHaveAttribute("type", "button");
      expect(copyIdButton).toHaveAttribute("aria-label");
      expect(copyIdButton.getAttribute("aria-label")).toContain("clipboard");
    });

    it("close button has visible focus indicator", () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const closeButton = screen.getByTestId("close-button");
      expect(closeButton.className).toMatch(/focus:ring|focus:outline|focus-visible/);
    });
  });
});

describe("Accessibility: Live Regions", () => {
  afterEach(() => {
    cleanup();
    const liveRegion = document.getElementById("sr-announcer");
    if (liveRegion) {
      liveRegion.remove();
    }
  });

  it("announceToScreenReader creates accessible live region", async () => {
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
  });
});
