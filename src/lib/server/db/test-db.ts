import { PGlite } from '@electric-sql/pglite';
import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema';

/**
 * Generates CREATE TABLE SQL from Drizzle schema table definition
 * Supports: text, timestamp with timezone, unique constraints, default values
 */
function generateCreateTableSQL(table: PgTable): string {
  const config = getTableConfig(table);
  const tableName = config.name;
  const columns: string[] = [];
  const uniqueConstraints: string[] = [];

  // Process columns
  for (const column of config.columns) {
    const parts: string[] = [`"${column.name}"`];

    // Add data type
    if (column.dataType === 'number') {
      if (column.columnType === 'PgSerial') {
        parts.push('SERIAL');
      } else {
        parts.push('INTEGER');
      }
    } else if (column.dataType === 'string') {
      if (column.columnType.includes('Text')) {
        parts.push('TEXT');
      } else if (column.columnType.includes('Varchar')) {
        // Extract length if available
        parts.push('VARCHAR(255)');
      } else {
        parts.push('TEXT');
      }
    } else if (column.dataType === 'boolean') {
      parts.push('BOOLEAN');
    } else if (column.dataType === 'date') {
      // Check if it's a timestamp with timezone
      if (column.columnType === 'PgTimestamp') {
        const withTimezone = (column as unknown as { withTimezone?: boolean }).withTimezone;
        if (withTimezone) {
          parts.push('TIMESTAMPTZ');
        } else {
          parts.push('TIMESTAMP');
        }
      } else {
        parts.push('TIMESTAMP');
      }
    } else if (column.dataType === 'json') {
      parts.push('JSONB');
    } else {
      // Default fallback
      parts.push('TEXT');
    }

    // Add constraints
    if (column.notNull) {
      parts.push('NOT NULL');
    }

    if (column.primary) {
      parts.push('PRIMARY KEY');
    }

    // Handle default values - check hasDefault first
    if (column.hasDefault) {
      // For timestamp columns with defaultNow(), we need to check the actual default
      if (column.dataType === 'date') {
        // Check if the column has a default function
        const defaultFn = (column as unknown as { default?: unknown }).default;
        if (defaultFn) {
          parts.push('DEFAULT NOW()');
        }
      } else if (column.default !== undefined) {
        const defaultValue = (column.default as unknown as { value?: unknown })?.value;
        if (defaultValue && typeof defaultValue === 'object' && 'sql' in defaultValue) {
          // Handle SQL default expressions
          const sqlValue = (defaultValue as { sql?: string }).sql;
          parts.push(`DEFAULT ${sqlValue}`);
        } else if (typeof defaultValue === 'string') {
          parts.push(`DEFAULT '${defaultValue}'`);
        } else if (typeof defaultValue === 'number') {
          parts.push(`DEFAULT ${defaultValue}`);
        } else if (typeof defaultValue === 'boolean') {
          parts.push(`DEFAULT ${defaultValue}`);
        }
      }
    }

    // Track unique constraints (will be added at table level)
    if (column.isUnique) {
      uniqueConstraints.push(`UNIQUE("${column.name}")`);
    }

    columns.push(parts.join(' '));
  }

  // Combine column definitions and unique constraints
  const allConstraints = [...columns, ...uniqueConstraints];

  // Create indexes
  const createTableSQL = `CREATE TABLE IF NOT EXISTS "${tableName}" (${allConstraints.join(', ')})`;

  return createTableSQL;
}

/**
 * Generates CREATE INDEX SQL for table indexes
 */
function generateIndexSQL(table: PgTable): string[] {
  const config = getTableConfig(table);
  const tableName = config.name;
  const indexSQLs: string[] = [];

  // Process indexes
  if (config.indexes) {
    for (const [indexName, index] of Object.entries(config.indexes)) {
      const columns = (index as unknown as { config?: { columns?: unknown[] } }).config?.columns;
      if (columns && columns.length > 0) {
        const columnNames = columns.map((col) => `"${(col as { name: string }).name}"`).join(', ');
        const indexSQL = `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${columnNames})`;
        indexSQLs.push(indexSQL);
      }
    }
  }

  return indexSQLs;
}

/**
 * Creates an in-memory PGlite database for testing with dynamic schema application
 */
export async function createTestDatabase(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  // Dynamically create all tables from schema
  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  for (const table of tables) {
    // Create table
    const createSQL = generateCreateTableSQL(table as PgTable);
    await db.execute(sql.raw(createSQL));

    // Create indexes
    const indexSQLs = generateIndexSQL(table as PgTable);
    for (const indexSQL of indexSQLs) {
      await db.execute(sql.raw(indexSQL));
    }
  }

  return db;
}

/**
 * Cleans all tables in the test database by truncating them dynamically
 */
export async function cleanDatabase(db: PgliteDatabase<typeof schema>): Promise<void> {
  // Get all table names from schema
  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  // Truncate all tables
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const tableName = config.name;

    try {
      await db.execute(sql.raw(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`));
    } catch (error) {
      // Table might not exist or other error, log but continue
      console.warn(`Could not truncate table ${tableName}:`, error);
    }
  }
}

/**
 * Creates a fresh test database for each test with cleanup function
 */
export async function setupTestDatabase(): Promise<{
  db: PgliteDatabase<typeof schema>;
  cleanup: () => Promise<void>;
}> {
  const db = await createTestDatabase();

  return {
    db,
    cleanup: async () => {
      await cleanDatabase(db);
    },
  };
}
