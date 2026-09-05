/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vite-plus/test";
import type { IncidentListItem } from "$lib/shared/types";
import type { PageData } from "../$types";

const { mockGoto, mockToastError } = vi.hoisted(() => ({
  mockGoto: vi.fn().mockResolvedValue(undefined),
  mockToastError: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
  goto: mockGoto,
}));

vi.mock("$lib/utils/toast", () => ({
  toastError: mockToastError,
  toastSuccess: vi.fn(),
}));

vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");
  return {
    navigating: writable(null),
    page: writable({ url: { pathname: "/projects/proj_1/incidents" } }),
  };
});

vi.mock("$lib/hooks/use-incident-stream.svelte", () => ({
  useIncidentStream: () => ({
    isConnected: false,
    isConnecting: false,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    setProjectId: vi.fn(),
  }),
}));

import IncidentsPage from "../+page.svelte";

function makeIncident(overrides: Partial<IncidentListItem> = {}): IncidentListItem {
  return {
    id: "inc_1",
    projectId: "proj_1",
    fingerprint: "fingerprint-1",
    title: "Incident one",
    normalizedMessage: "message one",
    serviceName: null,
    sourceFile: null,
    lineNumber: null,
    highestLevel: "error",
    firstSeen: "2024-01-15T14:00:00.000Z",
    lastSeen: "2024-01-15T14:30:00.000Z",
    totalEvents: 5,
    status: "open",
    ...overrides,
  };
}

function makeData(overrides: Partial<PageData> = {}): PageData {
  return {
    user: { id: "user_1", email: "admin@logwell.local", name: "admin" },
    session: { id: "session_1", expiresAt: new Date(Date.now() + 86_400_000) },
    project: { id: "proj_1", name: "Test Project" },
    autoResolveMinutes: 30,
    incidents: [makeIncident({ id: "inc_1" }), makeIncident({ id: "inc_2" })],
    pagination: { total: 4, hasMore: true, nextCursor: "cursor_1", limit: 50 },
    filters: { status: "open", range: "24h", selectedIncidentId: null },
    ...overrides,
  };
}

function makeLoadMoreResponse(): Response {
  return new Response(
    JSON.stringify({
      incidents: [
        makeIncident({ id: "inc_3", title: "Incident three" }),
        makeIncident({ id: "inc_4", title: "Incident four" }),
      ],
      nextCursor: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("IncidentsPage", () => {
  const user = userEvent.setup();
  let fetchMock: MockInstance;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/incidents?cursor=")) {
        return Promise.resolve(makeLoadMoreResponse());
      }
      return Promise.resolve(new Response(null, { status: 500 }));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("appends Load More incidents to the base list for display", async () => {
    const { rerender } = render(IncidentsPage, { props: { data: makeData() } });

    expect(screen.getAllByTestId("incident-row")).toHaveLength(2);

    const loadMoreButton = screen.getByRole("button", { name: /load more/i });
    await user.click(loadMoreButton);

    await waitFor(() => {
      expect(screen.getAllByTestId("incident-row")).toHaveLength(4);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/proj_1/incidents?cursor=cursor_1"),
    );

    await rerender({
      data: makeData({
        filters: { status: "open", range: "24h", selectedIncidentId: "inc_1" },
      }),
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("incident-row")).toHaveLength(4);
    });
  });

  it("resets to the base list when the status filter actually changes", async () => {
    const { rerender } = render(IncidentsPage, { props: { data: makeData() } });

    const loadMoreButton = screen.getByRole("button", { name: /load more/i });
    await user.click(loadMoreButton);
    await waitFor(() => {
      expect(screen.getAllByTestId("incident-row")).toHaveLength(4);
    });

    await rerender({
      data: makeData({
        incidents: [
          makeIncident({
            id: "inc_r1",
            title: "Resolved incident",
            status: "resolved",
            lastSeen: "2024-01-10T10:00:00.000Z",
          }),
        ],
        pagination: { total: 1, hasMore: false, nextCursor: null, limit: 50 },
        filters: { status: "resolved", range: "24h", selectedIncidentId: null },
      }),
    });

    await waitFor(() => {
      const rows = screen.getAllByTestId("incident-row");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("Resolved incident");
    });
  });

  it("navigates with the incident selection param when a row is selected", async () => {
    render(IncidentsPage, { props: { data: makeData() } });

    const firstRow = screen.getAllByTestId("incident-row")[0]!;
    await user.click(firstRow);

    expect(mockGoto).toHaveBeenCalledWith(
      "/projects/proj_1/incidents?status=open&range=24h&incident=inc_1",
      expect.objectContaining({ replaceState: true, noScroll: true }),
    );
  });

  it("toasts when Load More fails", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 500 })));

    render(IncidentsPage, { props: { data: makeData() } });

    const loadMoreButton = screen.getByRole("button", { name: /load more/i });
    await user.click(loadMoreButton);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Failed to load more incidents");
    });
  });
});
