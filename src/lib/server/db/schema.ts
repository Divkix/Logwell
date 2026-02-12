import { type SQL, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Project table
export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    apiKey: text('api_key').notNull().unique(),
    // Owner of the project - required for authorization
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Log retention configuration:
    // - null: use system default (LOG_RETENTION_DAYS env var)
    // - 0: never auto-delete logs
    // - >0: delete logs older than N days
    retentionDays: integer('retention_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_project_api_key').on(table.apiKey),
    index('idx_project_owner_id').on(table.ownerId),
  ],
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

// Incident table with fingerprint grouping
export const incident = pgTable(
  'incident',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    normalizedMessage: text('normalized_message').notNull(),
    serviceName: text('service_name'),
    sourceFile: text('source_file'),
    lineNumber: integer('line_number'),
    highestLevel: logLevelEnum('highest_level').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(),
    totalEvents: integer('total_events').notNull().default(0),
    reopenCount: integer('reopen_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_incident_project_last_seen').on(table.projectId, table.lastSeen),
    uniqueIndex('uq_incident_project_fingerprint').on(table.projectId, table.fingerprint),
  ],
);

// Type exports for incident
export type Incident = typeof incident.$inferSelect;
export type NewIncident = typeof incident.$inferInsert;

// Log table with full-text search
export const log = pgTable(
  'log',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    incidentId: text('incident_id').references(() => incident.id, { onDelete: 'set null' }),
    fingerprint: text('fingerprint'),
    serviceName: text('service_name'),
    level: logLevelEnum('level').notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata'),
    timeUnixNano: text('time_unix_nano'),
    observedTimeUnixNano: text('observed_time_unix_nano'),
    severityNumber: integer('severity_number'),
    severityText: text('severity_text'),
    body: jsonb('body'),
    droppedAttributesCount: integer('dropped_attributes_count'),
    flags: integer('flags'),
    traceId: text('trace_id'),
    spanId: text('span_id'),
    resourceAttributes: jsonb('resource_attributes'),
    resourceDroppedAttributesCount: integer('resource_dropped_attributes_count'),
    resourceSchemaUrl: text('resource_schema_url'),
    scopeName: text('scope_name'),
    scopeVersion: text('scope_version'),
    scopeAttributes: jsonb('scope_attributes'),
    scopeDroppedAttributesCount: integer('scope_dropped_attributes_count'),
    scopeSchemaUrl: text('scope_schema_url'),
    sourceFile: text('source_file'),
    lineNumber: integer('line_number'),
    requestId: text('request_id'),
    userId: text('user_id'),
    ipAddress: text('ip_address'),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
    search: tsvector('search').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', ${log.message}), 'A') ||
        setweight(to_tsvector('english', COALESCE(${log.body}::text, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(${log.metadata}::text, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(${log.resourceAttributes}::text, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(${log.scopeAttributes}::text, '')), 'C')`,
    ),
  },
  (table) => [
    index('idx_log_project_id').on(table.projectId),
    index('idx_log_project_incident_timestamp').on(table.projectId, table.incidentId, table.timestamp),
    index('idx_log_project_fingerprint_timestamp').on(table.projectId, table.fingerprint, table.timestamp),
    index('idx_log_project_service_name').on(table.projectId, table.serviceName),
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

// better-auth tables

// User table
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Type exports for user
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

// Session table
export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

// Type exports for session
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

// Account table
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

// Type exports for account
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

// Verification table
export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

// Type exports for verification
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
