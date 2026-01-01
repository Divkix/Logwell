import { type SQL, sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Project table
export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    apiKey: text('api_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_project_api_key').on(table.apiKey)],
);

// Type exports for project
export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;

// Custom tsvector type for Drizzle
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Log level enum
export const logLevelEnum = pgEnum('log_level', ['debug', 'info', 'warn', 'error', 'fatal']);

// Log table with full-text search
export const log = pgTable(
  'log',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    level: logLevelEnum('level').notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata'),
    sourceFile: text('source_file'),
    lineNumber: integer('line_number'),
    requestId: text('request_id'),
    userId: text('user_id'),
    ipAddress: text('ip_address'),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
    search: tsvector('search').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', ${log.message}), 'A') || setweight(to_tsvector('english', COALESCE(${log.metadata}::text, '')), 'B')`,
    ),
  },
  (table) => [
    index('idx_log_project_id').on(table.projectId),
    index('idx_log_timestamp').on(table.timestamp),
    index('idx_log_level').on(table.level),
    index('idx_log_project_timestamp').on(table.projectId, table.timestamp),
    // GIN index for full-text search (needs special handling in test-db.ts)
    index('idx_log_search').on(table.search),
  ],
);

// Type exports for log
export type Log = typeof log.$inferSelect;
export type NewLog = typeof log.$inferInsert;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
