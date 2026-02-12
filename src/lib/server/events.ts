import type { Incident, Log } from './db/schema';

export type LogListener = (log: Log) => void;
export type IncidentListener = (incident: Incident) => void;

/**
 * In-memory event bus for log streaming.
 * Project-scoped: each project has its own set of listeners.
 * Used to broadcast new logs to connected SSE clients.
 */
class LogEventBus {
  private listeners: Map<string, Set<LogListener>> = new Map();
  private incidentListeners: Map<string, Set<IncidentListener>> = new Map();

  /**
   * Subscribe to log events for a specific project.
   * @param projectId - The project to subscribe to
   * @param listener - Callback function to receive logs
   * @returns Unsubscribe function
   */
  onLog(projectId: string, listener: LogListener): () => void {
    let projectListeners = this.listeners.get(projectId);
    if (!projectListeners) {
      projectListeners = new Set();
      this.listeners.set(projectId, projectListeners);
    }
    projectListeners.add(listener);

    return () => {
      const projectListeners = this.listeners.get(projectId);
      if (projectListeners) {
        projectListeners.delete(listener);
        if (projectListeners.size === 0) {
          this.listeners.delete(projectId);
        }
      }
    };
  }

  /**
   * Emit a log event to all listeners subscribed to its project.
   * @param log - The log entry to emit
   */
  emitLog(log: Log): void {
    const projectListeners = this.listeners.get(log.projectId);
    if (projectListeners) {
      for (const listener of projectListeners) {
        listener(log);
      }
    }
  }

  /**
   * Subscribe to incident events for a specific project.
   * @param projectId - The project to subscribe to
   * @param listener - Callback function to receive incidents
   * @returns Unsubscribe function
   */
  onIncident(projectId: string, listener: IncidentListener): () => void {
    let projectListeners = this.incidentListeners.get(projectId);
    if (!projectListeners) {
      projectListeners = new Set();
      this.incidentListeners.set(projectId, projectListeners);
    }
    projectListeners.add(listener);

    return () => {
      const projectListeners = this.incidentListeners.get(projectId);
      if (projectListeners) {
        projectListeners.delete(listener);
        if (projectListeners.size === 0) {
          this.incidentListeners.delete(projectId);
        }
      }
    };
  }

  /**
   * Emit an incident event to all listeners subscribed to its project.
   * @param incident - The incident entry to emit
   */
  emitIncident(incident: Incident): void {
    const projectListeners = this.incidentListeners.get(incident.projectId);
    if (projectListeners) {
      for (const listener of projectListeners) {
        listener(incident);
      }
    }
  }

  /**
   * Get the number of listeners for a specific project.
   * @param projectId - The project to check
   * @returns Number of active listeners
   */
  getListenerCount(projectId: string): number {
    return this.listeners.get(projectId)?.size ?? 0;
  }

  /**
   * Get the number of incident listeners for a specific project.
   * @param projectId - The project to check
   * @returns Number of active incident listeners
   */
  getIncidentListenerCount(projectId: string): number {
    return this.incidentListeners.get(projectId)?.size ?? 0;
  }

  /**
   * Clear all listeners from all projects.
   * Primarily used for testing.
   */
  clear(): void {
    this.listeners.clear();
    this.incidentListeners.clear();
  }
}

// Singleton instance for the application
export const logEventBus = new LogEventBus();
