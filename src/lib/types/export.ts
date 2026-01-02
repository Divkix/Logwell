export type ExportFormat = 'csv' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  level?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface ExportableLog {
  id: string;
  level: string;
  message: string;
  timestamp: string;
  metadata: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  requestId: string | null;
  userId: string | null;
  ipAddress: string | null;
}
