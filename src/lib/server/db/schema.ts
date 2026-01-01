import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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

// Type exports
export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
