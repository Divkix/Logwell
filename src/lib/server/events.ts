import type { Incident, Log } from "./db/schema";

export type StreamLog = Omit<Log, "search">;

export type LogListener = (log: StreamLog) => void;
export type IncidentListener = (incident: Incident) => void;

class LogEventBus {
  private listeners: Map<string, Set<LogListener>> = new Map();
  private incidentListeners: Map<string, Set<IncidentListener>> = new Map();

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

  emitLog(log: StreamLog): void {
    const projectListeners = this.listeners.get(log.projectId);
    if (projectListeners) {
      for (const listener of projectListeners) {
        try {
          listener(log);
        } catch (e) {
          console.error("[events] listener error:", e);
        }
      }
    }
  }

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

  emitIncident(incident: Incident): void {
    const projectListeners = this.incidentListeners.get(incident.projectId);
    if (projectListeners) {
      for (const listener of projectListeners) {
        try {
          listener(incident);
        } catch (e) {
          console.error("[events] listener error:", e);
        }
      }
    }
  }

  getListenerCount(projectId: string): number {
    return this.listeners.get(projectId)?.size ?? 0;
  }

  getIncidentListenerCount(projectId: string): number {
    return this.incidentListeners.get(projectId)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
    this.incidentListeners.clear();
  }
}

export const logEventBus = new LogEventBus();
