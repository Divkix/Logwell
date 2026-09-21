/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ClientLog } from "$lib/stores/logs.svelte";
import type { PageData } from "../$types";

const mocks = vi.hoisted(() => ({
  goto: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
  navigating: null as unknown as { set(value: unknown): void },
  onLogs: null as unknown as (logs: ClientLog[]) => void,
  connect: vi.fn(),
  disconnect: vi.fn(),
  setProjectId: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
}));

// The factory runs while modules are still loading, so `svelte/store` cannot be a
// top-level binding here.
vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");
  mocks.navigating = writable(null);

  return {
    navigating: mocks.navigating,
    page: writable({ url: { pathname: "/projects/proj_1" } }),
  };
});

vi.mock("$lib/utils/toast", () => ({
  toastError: mocks.toastError,
  toastSuccess: vi.fn(),
}));

vi.mock("$lib/hooks/use-log-stream.svelte", () => ({
  useLogStream: (options: { onLogs: (logs: ClientLog[]) => void }) => {
    mocks.onLogs = options.onLogs;

    return {
      isConnected: false,
      isConnecting: false,
      error: null,
      connect: mocks.connect,
      disconnect: mocks.disconnect,
      setProjectId: mocks.setProjectId,
    };
  },
}));

import LogsPage from "../+page.svelte";

const RANGE_FROM = "2024-01-15T11:00:00.000Z";

function makeLog(overrides: Partial<PageData["logs"][number]> = {}): PageData["logs"][number] {
  return {
    id: "log_1",
    projectId: "proj_1",
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "base log",
    metadata: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: "2024-01-15T12:00:00.000Z",
    ...overrides,
  };
}

function makeData(overrides: Partial<PageData> = {}): PageData {
  return {
    user: { id: "user_1", email: "admin@logwell.local", name: "admin" },
    session: { id: "session_1", expiresAt: new Date(Date.now() + 86_400_000) },
    project: {
      id: "proj_1",
      name: "Test Project",
      retentionDays: 30,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    logs: [makeLog()],
    pagination: {
      total: 1,
      totalIsCapped: false,
      hasMore: false,
      limit: 100,
      offset: 0,
      nextCursor: null,
    },
    filters: { levels: [], search: "", range: "1h", from: RANGE_FROM },
    appUrl: "http://localhost:5173",
    ...overrides,
  };
}

function makeClientLog(overrides: Partial<ClientLog> = {}): ClientLog {
  return {
    id: "stream_1",
    projectId: "proj_1",
    level: "info",
    message: "streamed log",
    metadata: null,
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: "2024-01-15T12:30:00.000Z",
    ...overrides,
  };
}

function makeLoadMoreData(overrides: Partial<PageData> = {}): PageData {
  return makeData({
    pagination: {
      total: 5,
      totalIsCapped: false,
      hasMore: true,
      limit: 100,
      offset: 0,
      nextCursor: "cursor_1",
    },
    ...overrides,
  });
}

describe("LogsPage", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mocks.navigating.set(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("clears the loading skeleton once the navigation that mounted the page finishes", async () => {
    mocks.navigating.set({
      to: { url: new URL("http://localhost/projects/proj_1") },
      from: null,
      type: "goto",
    });

    render(LogsPage, { props: { data: makeData() } });

    expect(screen.getByTestId("log-stream-skeleton")).toBeInTheDocument();

    mocks.navigating.set(null);

    await waitFor(() => {
      expect(screen.queryByTestId("log-stream-skeleton")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("log-table")).toBeInTheDocument();
    expect(screen.queryAllByText("base log").length).toBeGreaterThan(0);
  });

  it("ignores streamed logs that do not match the active level filter", async () => {
    render(LogsPage, {
      props: {
        data: makeData({
          filters: { levels: ["error"], search: "", range: "1h", from: RANGE_FROM },
        }),
      },
    });

    mocks.onLogs([
      makeClientLog({ id: "stream_info", level: "info", message: "info-not-matching" }),
      makeClientLog({ id: "stream_error", level: "error", message: "error-matching" }),
    ]);

    await waitFor(() => {
      expect(screen.queryAllByText("error-matching").length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText("info-not-matching")).toHaveLength(0);
  });

  it("ignores streamed logs that fall outside the resolved range window", async () => {
    render(LogsPage, { props: { data: makeData() } });

    mocks.onLogs([
      makeClientLog({
        id: "stream_old",
        message: "older-than-window",
        timestamp: "2024-01-15T10:00:00.000Z",
      }),
      makeClientLog({
        id: "stream_new",
        message: "inside-window",
        timestamp: "2024-01-15T11:30:00.000Z",
      }),
    ]);

    await waitFor(() => {
      expect(screen.queryAllByText("inside-window").length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText("older-than-window")).toHaveLength(0);
  });

  it("re-syncs the filter controls when navigation data changes", async () => {
    const { rerender } = render(LogsPage, {
      props: {
        data: makeData({ filters: { levels: [], search: "boom", range: "1h", from: RANGE_FROM } }),
      },
    });

    expect(screen.getByTestId("filter-chip-search")).toHaveTextContent('"boom"');

    await rerender({
      data: makeData({
        filters: { levels: ["error"], search: "", range: "24h", from: RANGE_FROM },
      }),
    });

    await waitFor(() => {
      expect(screen.queryByTestId("filter-chip-search")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("filter-chip-level-error")).toBeInTheDocument();
    expect(screen.getByTestId("filter-chip-range")).toHaveTextContent("24h");
  });

  it("discards a Load More response that a filter change superseded", async () => {
    const { promise: fetchPromise, resolve: resolveFetch } = Promise.withResolvers<Response>();
    let staleJsonCalls = 0;

    // Plain stub so the promise the component awaits is exactly the one this test resolves.
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/projects/proj_1/logs?cursor=")) return fetchPromise;

      return Promise.resolve(new Response(null, { status: 500 }));
    }) as typeof fetch;

    const { rerender } = render(LogsPage, { props: { data: makeLoadMoreData() } });

    await user.click(screen.getByTestId("load-more-button"));

    await rerender({
      data: makeLoadMoreData({
        logs: [makeLog({ id: "log_error", level: "error", message: "filtered error log" })],
        pagination: {
          total: 5,
          totalIsCapped: false,
          hasMore: true,
          limit: 100,
          offset: 0,
          nextCursor: "cursor_2",
        },
        filters: { levels: ["error"], search: "", range: "1h", from: RANGE_FROM },
      }),
    });

    const staleResponse = new Response(null, { status: 200 });
    staleResponse.json = () => {
      staleJsonCalls++;

      return Promise.resolve({
        logs: [makeLog({ id: "log_stale", level: "error", message: "stale page log" })],
        nextCursor: null,
      });
    };

    resolveFetch(staleResponse);
    await fetchPromise;
    // The component resumes one microtask after its own fetch settles; give it that hop so the
    // assertions below see the final state of a response the component actually consumed.
    await Promise.resolve();

    // The superseded page is never read, so neither its rows nor its cursor can reach the view.
    expect(staleJsonCalls).toBe(0);
    expect(screen.queryAllByText("stale page log")).toHaveLength(0);
    expect(screen.queryAllByText("filtered error log").length).toBeGreaterThan(0);
    expect(screen.getByTestId("load-more-button")).toBeInTheDocument();
  });

  it("does not report a failure for a Load More response that a filter change superseded", async () => {
    const { promise: fetchPromise, resolve: resolveFetch } = Promise.withResolvers<Response>();

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/projects/proj_1/logs?cursor=")) return fetchPromise;

      return Promise.resolve(new Response(null, { status: 500 }));
    }) as typeof fetch;

    const { rerender } = render(LogsPage, { props: { data: makeLoadMoreData() } });

    await user.click(screen.getByTestId("load-more-button"));

    await rerender({
      data: makeLoadMoreData({
        pagination: {
          total: 5,
          totalIsCapped: false,
          hasMore: true,
          limit: 100,
          offset: 0,
          nextCursor: "cursor_2",
        },
        filters: { levels: ["error"], search: "", range: "24h", from: RANGE_FROM },
      }),
    });

    resolveFetch(new Response(null, { status: 500 }));
    await fetchPromise;
    await Promise.resolve();

    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
