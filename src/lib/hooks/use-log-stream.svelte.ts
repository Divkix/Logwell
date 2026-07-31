import type { ClientLog } from "$lib/stores/logs.svelte";

/**
 * Configuration options for the useLogStream hook
 */
export interface UseLogStreamOptions {
  /** Project ID to stream logs from */
  projectId: string;
  /** Whether the stream should be active */
  enabled: boolean;
  /** Callback when new log batches arrive */
  onLogs?: (logs: ClientLog[]) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Callback when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
  /** Maximum number of reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnection in ms (default: 3000) */
  reconnectBaseDelay?: number;
}

/**
 * Return type for the useLogStream hook
 */
export interface UseLogStreamReturn {
  /** Whether currently connected to the SSE stream */
  isConnected: boolean;
  /** Whether currently attempting to connect */
  isConnecting: boolean;
  /** Current error, if any */
  error: Error | null;
  /** Manually initiate connection */
  connect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
  /** Change the project subscribed to by the stream */
  setProjectId: (id: string) => void;
}

/**
 * Default configuration values
 */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY = 3000;

/**
 * Hook for subscribing to real-time log streams via SSE
 *
 * Features:
 * - Automatic connection management based on `enabled` flag
 * - SSE event parsing for log batches
 * - Automatic reconnection with exponential backoff
 * - Clean disconnection with proper cleanup
 *
 * @param options - Hook configuration options
 * @returns Stream control interface
 */
export function useLogStream(options: UseLogStreamOptions): UseLogStreamReturn {
  const {
    projectId,
    enabled,
    onLogs,
    onError,
    onConnectionChange,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    reconnectBaseDelay = DEFAULT_RECONNECT_BASE_DELAY,
  } = options;

  // Internal state
  // NOTE: these are intentionally plain (non-reactive) variables. connect()/disconnect() mutate
  // them and are invoked from a component $effect; making them $state caused the effect to take a
  // reactive dependency on them (via connect()'s guard reads) while also writing them, producing an
  // infinite update loop (effect_update_depth_exceeded) that broke page hydration. Connection state
  // is surfaced reactively to the UI via the onConnectionChange callback instead.
  let _isConnected = false;
  let _isConnecting = false;
  let _error: Error | null = null;
  let _abortController: AbortController | null = null;
  let _reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let _reconnectAttempts = 0;
  let _isDisconnected = true;
  let _projectId = projectId;
  let _epoch = 0;

  /**
   * Updates connection state and triggers callback
   */
  function setConnected(connected: boolean): void {
    if (_isConnected !== connected) {
      _isConnected = connected;
      onConnectionChange?.(connected);
    }
  }

  function processSSEBuffer(buffer: string): string {
    let frameEnd = buffer.indexOf("\n\n");
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd);
      let event = "";
      let data = "";

      for (const line of frame.split("\n")) {
        const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (normalizedLine.startsWith("event: ")) {
          event = normalizedLine.slice(7);
        } else if (normalizedLine.startsWith("data: ")) {
          data = normalizedLine.slice(6);
        }
      }

      if (event && data) {
        processSSEEvents([{ event, data }]);
      }

      buffer = buffer.slice(frameEnd + 2);
      frameEnd = buffer.indexOf("\n\n");
    }
    return buffer;
  }

  /**
   * Processes parsed SSE events
   */
  function processSSEEvents(events: Array<{ event: string; data: string }>): void {
    for (const event of events) {
      if (event.event === "logs") {
        try {
          const logs = JSON.parse(event.data) as ClientLog[];
          onLogs?.(logs);
        } catch {
          // Silently ignore malformed JSON - continue processing other events
        }
      }
      // Heartbeat events are intentionally ignored
    }
  }

  /**
   * Schedules a reconnection attempt with exponential backoff
   */
  function scheduleReconnect(): void {
    if (_isDisconnected) return;
    if (_reconnectAttempts >= maxReconnectAttempts) return;

    const delay = reconnectBaseDelay * 2 ** _reconnectAttempts;
    _reconnectAttempts++;

    _reconnectTimeoutId = setTimeout(() => {
      if (!_isDisconnected) {
        connect();
      }
    }, delay);
  }

  /**
   * Connects to the SSE endpoint
   */
  function connect(): void {
    // Prevent duplicate connections
    if (_isConnecting || _isConnected) return;

    _isDisconnected = false;
    _isConnecting = true;
    _error = null;
    _abortController = new AbortController();
    const myEpoch = ++_epoch;

    fetch(`/api/projects/${_projectId}/logs/stream`, {
      method: "POST",
      credentials: "same-origin",
      signal: _abortController.signal,
    })
      .then(async (response) => {
        if (myEpoch !== _epoch) return;
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("Response body is empty");
        }

        _isConnecting = false;
        setConnected(true);
        _reconnectAttempts = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (myEpoch !== _epoch) return;

            buffer += decoder.decode(value, { stream: true });
            buffer = processSSEBuffer(buffer);
          }
        } catch (error) {
          // Stream was aborted or errored
          if (myEpoch === _epoch && !_isDisconnected) {
            _error = error instanceof Error ? error : new Error(String(error));
            onError?.(_error);
          }
        } finally {
          reader.releaseLock();
        }

        // Connection closed (stream ended)
        if (myEpoch === _epoch && !_isDisconnected) {
          setConnected(false);
          scheduleReconnect();
        }
      })
      .catch((error) => {
        if (myEpoch !== _epoch) return;
        _isConnecting = false;

        // Ignore abort errors from intentional disconnection
        if (error?.name === "AbortError" && _isDisconnected) {
          return;
        }

        _error = error instanceof Error ? error : new Error(String(error));
        onError?.(_error);
        setConnected(false);

        // Don't reconnect on permanent errors (404)
        if (_error.message.startsWith("HTTP 404:")) return;

        // Schedule reconnection attempt
        scheduleReconnect();
      });
  }

  /**
   * Disconnects from the SSE endpoint
   */
  function disconnect(): void {
    _epoch++;
    _isDisconnected = true;

    // Clear any pending reconnection
    if (_reconnectTimeoutId) {
      clearTimeout(_reconnectTimeoutId);
      _reconnectTimeoutId = null;
    }

    // Abort current connection
    if (_abortController) {
      _abortController.abort();
      _abortController = null;
    }

    _isConnecting = false;
    _reconnectAttempts = 0;
    setConnected(false);
  }

  function setProjectId(id: string): void {
    if (id === _projectId) return;
    _projectId = id;
    if (!_isDisconnected) {
      disconnect();
      connect();
    }
  }

  // Auto-connect if enabled on creation (only in browser)
  if (enabled && typeof window !== "undefined") {
    // Use queueMicrotask to allow the return value to be captured first
    queueMicrotask(() => {
      connect();
    });
  }

  return {
    get isConnected() {
      return _isConnected;
    },
    get isConnecting() {
      return _isConnecting;
    },
    get error() {
      return _error;
    },
    connect,
    disconnect,
    setProjectId,
  };
}
