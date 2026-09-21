import type { Incident, Log } from "./db/schema";

export type StreamLog = Omit<Log, "search">;

export type LogListener = (log: StreamLog) => void;

export type IncidentListener = (incident: Incident) => void;

export type Listener<T> = (item: T) => void;

class ProjectChannel<T> {
  private listeners: Map<string, Set<Listener<T>>> = new Map();

  subscribe(projectId: string, listener: Listener<T>): () => void {
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

  emit(projectId: string, item: T): void {
    const projectListeners = this.listeners.get(projectId);

    if (projectListeners) {
      for (const listener of projectListeners) {
        try {
          listener(item);
        } catch (e) {
          console.error("[events] listener error:", e);
        }
      }
    }
  }

  count(projectId: string): number {
    return this.listeners.get(projectId)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}

class LogEventBus {
  private logs = new ProjectChannel<StreamLog>();
  private incidents = new ProjectChannel<Incident>();

  onLog(projectId: string, listener: LogListener): () => void {
    return this.logs.subscribe(projectId, listener);
  }

  emitLog(log: StreamLog): void {
    this.logs.emit(log.projectId, log);
  }

  onIncident(projectId: string, listener: IncidentListener): () => void {
    return this.incidents.subscribe(projectId, listener);
  }

  emitIncident(incident: Incident): void {
    this.incidents.emit(incident.projectId, incident);
  }

  getListenerCount(projectId: string): number {
    return this.logs.count(projectId);
  }

  getIncidentListenerCount(projectId: string): number {
    return this.incidents.count(projectId);
  }

  clear(): void {
    this.logs.clear();
    this.incidents.clear();
  }
}

export const logEventBus = new LogEventBus();
