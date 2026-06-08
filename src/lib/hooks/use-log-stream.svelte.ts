import type { ClientLog } from '$lib/stores/logs.svelte';

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
  let _isConnected = $state(false);
  let _isConnecting = $state(false);
  let _error = $state<Error | null>(null);
  let _abortController: AbortController | null = null;
  let _reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let _reconnectAttempts = 0;
  let _isDisconnected = true;

  /**
   * Updates connection state and triggers callback
   */
  function setConnected(connected: boolean): void {
    if (_isConnected !== connected) {
      _isConnected = connected;
      onConnectionChange?.(connected);
    }
  }

  /**
   * Parses SSE events from a buffer string
   * Returns parsed events and remaining buffer
   */
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

  /**
   * Processes parsed SSE events
   */
  function processSSEEvents(events: Array<{ event: string; data: string }>): void {
    for (const event of events) {
      if (event.event === 'logs') {
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

    fetch(`/api/projects/${projectId}/logs/stream`, {
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
          // Stream was aborted or errored
          if (!_isDisconnected) {
            _error = error instanceof Error ? error : new Error(String(error));
            onError?.(_error);
          }
        } finally {
          reader.releaseLock();
        }

        // Connection closed (stream ended)
        if (!_isDisconnected) {
          setConnected(false);
          scheduleReconnect();
        }
      })
      .catch((error) => {
        _isConnecting = false;

        // Ignore abort errors from intentional disconnection
        if (error?.name === 'AbortError' && _isDisconnected) {
          return;
        }

        _error = error instanceof Error ? error : new Error(String(error));
        onError?.(_error);
        setConnected(false);

        // Don't reconnect on permanent errors (404)
        if (_error.message.startsWith('HTTP 404:')) return;

        // Schedule reconnection attempt
        scheduleReconnect();
      });
  }

  /**
   * Disconnects from the SSE endpoint
   */
  function disconnect(): void {
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

  // Auto-connect if enabled on creation (only in browser)
  if (enabled && typeof window !== 'undefined') {
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
  };
}
