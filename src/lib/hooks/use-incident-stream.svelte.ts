/**
 * Client-side incident shape from SSE payloads.
 */
export interface ClientIncident {
  id: string;
  projectId: string;
  fingerprint: string;
  title: string;
  normalizedMessage: string;
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  highestLevel: "debug" | "info" | "warn" | "error" | "fatal";
  firstSeen: string;
  lastSeen: string;
  totalEvents: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UseIncidentStreamOptions {
  projectId: string;
  enabled: boolean;
  onIncidents?: (incidents: ClientIncident[]) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (connected: boolean) => void;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
}

export interface UseIncidentStreamReturn {
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  connect: () => void;
  disconnect: () => void;
  setProjectId: (id: string) => void;
}

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY = 3000;

export function useIncidentStream(options: UseIncidentStreamOptions): UseIncidentStreamReturn {
  const {
    projectId,
    enabled,
    onIncidents,
    onError,
    onConnectionChange,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    reconnectBaseDelay = DEFAULT_RECONNECT_BASE_DELAY,
  } = options;

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

  function processSSEEvents(events: Array<{ event: string; data: string }>): void {
    for (const event of events) {
      if (event.event === "incidents") {
        try {
          const incidents = JSON.parse(event.data) as ClientIncident[];
          onIncidents?.(incidents);
        } catch {
          // ignore malformed payload
        }
      }
    }
  }

  function scheduleReconnect(): void {
    if (_isDisconnected) return;
    if (_reconnectAttempts >= maxReconnectAttempts) return;

    const delay = reconnectBaseDelay * 2 ** _reconnectAttempts;
    _reconnectAttempts++;

    _reconnectTimeoutId = setTimeout(() => {
      if (!_isDisconnected) connect();
    }, delay);
  }

  function connect(): void {
    if (_isConnecting || _isConnected) return;

    _isDisconnected = false;
    _isConnecting = true;
    _error = null;
    _abortController = new AbortController();
    const myEpoch = ++_epoch;

    fetch(`/api/projects/${_projectId}/incidents/stream`, {
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
          if (myEpoch === _epoch && !_isDisconnected) {
            _error = error instanceof Error ? error : new Error(String(error));
            onError?.(_error);
          }
        } finally {
          reader.releaseLock();
        }

        if (myEpoch === _epoch && !_isDisconnected) {
          setConnected(false);
          scheduleReconnect();
        }
      })
      .catch((error) => {
        if (myEpoch !== _epoch) return;
        _isConnecting = false;
        if (error?.name === "AbortError" && _isDisconnected) return;

        _error = error instanceof Error ? error : new Error(String(error));
        onError?.(_error);
        setConnected(false);

        // Don't reconnect on permanent errors (404)
        if (_error.message.startsWith("HTTP 404:")) return;

        scheduleReconnect();
      });
  }

  function disconnect(): void {
    _epoch++;
    _isDisconnected = true;

    if (_reconnectTimeoutId) {
      clearTimeout(_reconnectTimeoutId);
      _reconnectTimeoutId = null;
    }
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

  if (enabled && typeof window !== "undefined") {
    queueMicrotask(() => connect());
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
