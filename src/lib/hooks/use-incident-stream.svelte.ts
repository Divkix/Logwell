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
  highestLevel: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  firstSeen: string;
  lastSeen: string;
  totalEvents: number;
  reopenCount: number;
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

  let _isConnected = false;
  let _isConnecting = false;
  let _error: Error | null = null;
  let _abortController: AbortController | null = null;
  let _reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let _reconnectAttempts = 0;
  let _isDisconnected = true;

  function setConnected(connected: boolean): void {
    if (_isConnected !== connected) {
      _isConnected = connected;
      onConnectionChange?.(connected);
    }
  }

  function parseSSEBuffer(buffer: string): {
    events: Array<{ event: string; data: string }>;
    remaining: string;
  } {
    const lines = buffer.split('\n');
    const remaining = lines.pop() || '';
    const events: Array<{ event: string; data: string }> = [];

    let currentEvent = '';
    let currentData = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line === '' && currentEvent && currentData) {
        events.push({ event: currentEvent, data: currentData });
        currentEvent = '';
        currentData = '';
      }
    }

    return { events, remaining };
  }

  function processSSEEvents(events: Array<{ event: string; data: string }>): void {
    for (const event of events) {
      if (event.event === 'incidents') {
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

    fetch(`/api/projects/${projectId}/incidents/stream`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: _abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error('Response body is empty');
        }

        _isConnecting = false;
        setConnected(true);
        _reconnectAttempts = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const { events, remaining } = parseSSEBuffer(buffer);
            buffer = remaining;
            processSSEEvents(events);
          }
        } catch (error) {
          if (!_isDisconnected) {
            _error = error instanceof Error ? error : new Error(String(error));
            onError?.(_error);
          }
        } finally {
          reader.releaseLock();
        }

        if (!_isDisconnected) {
          setConnected(false);
          scheduleReconnect();
        }
      })
      .catch((error) => {
        _isConnecting = false;
        if (error?.name === 'AbortError' && _isDisconnected) return;

        _error = error instanceof Error ? error : new Error(String(error));
        onError?.(_error);
        setConnected(false);
        scheduleReconnect();
      });
  }

  function disconnect(): void {
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

  if (enabled && typeof window !== 'undefined') {
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
  };
}
