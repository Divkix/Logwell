import type { LogLevel } from "$lib/shared/types";

export interface ClientLog {
  id: string;
  projectId: string;
  level: LogLevel;
  message: string;
  metadata: unknown;
  incidentId: string | null;
  fingerprint: string | null;
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  requestId: string | null;
  userId: string | null;
  ipAddress: string | null;
  timestamp: string;
}
