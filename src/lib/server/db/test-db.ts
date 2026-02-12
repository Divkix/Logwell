import { PGlite } from '@electric-sql/pglite';
import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema';

/**
 * Generates CREATE TABLE SQL from Drizzle schema table definition
 * Supports: text, timestamp with timezone, integer, jsonb, enums, boolean, unique constraints, default values, foreign keys
 */
function generateCreateTableSQL(table: PgTable): string {
  const config = getTableConfig(table);
  const tableName = config.name;
  const columns: string[] = [];
  const uniqueConstraints: string[] = [];

  // Process columns
  for (const column of config.columns) {
    const parts: string[] = [`"${column.name}"`];

    // Handle custom types (like tsvector)
    const columnType = column.columnType;
    const isCustomType = columnType === 'PgCustomColumn';
    const isEnumType = columnType === 'PgEnumColumn';
    const isGeneratedColumn = (column as { generated?: unknown }).generated !== undefined;

    // Add data type
    if (isCustomType) {
      // For custom types like tsvector, use the dataType() method
      const customColumn = column as unknown as { getSQLType?: () => string };
      if (customColumn.getSQLType) {
        parts.push(customColumn.getSQLType());
      } else {
        // Fallback for tsvector
        parts.push('TSVECTOR');
      }
    } else if (isEnumType) {
      // For enum columns, use the enum type name
      const enumColumn = column as unknown as { enumName?: string };
      if (enumColumn.enumName) {
        parts.push(enumColumn.enumName);
      } else {
        parts.push('TEXT');
      }
    } else if (column.dataType === 'number') {
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

    // Handle generated columns
    if (isGeneratedColumn) {
      const generated = (column as { generated?: { as: unknown; type?: string } }).generated;
      if (generated && generated.type === 'stored') {
        // Skip generated columns in PGlite as it has limited support
        // We'll handle full-text search via triggers
        continue;
      }
    }

    // Add constraints
    if (column.notNull) {
      parts.push('NOT NULL');
    }

    if (column.primary) {
      parts.push('PRIMARY KEY');
    }

    // Handle default values - check hasDefault first
    if (column.hasDefault && !isGeneratedColumn) {
      // For timestamp columns with defaultNow(), we need to check the actual default
      if (column.dataType === 'date') {
        // Check if the column has a default function
        const defaultFn = (column as unknown as { default?: unknown }).default;
        if (defaultFn) {
          parts.push('DEFAULT NOW()');
        }
      } else if (column.dataType === 'boolean') {
        // Handle boolean defaults
        const defaultValue = (column as unknown as { default?: unknown }).default;
        if (defaultValue !== undefined) {
          // Check if it's a simple value or wrapped
          const value =
            typeof defaultValue === 'object' && defaultValue !== null && 'value' in defaultValue
              ? (defaultValue as { value: unknown }).value
              : defaultValue;
          parts.push(`DEFAULT ${value}`);
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

  // Process foreign keys from table config
  const foreignKeys: string[] = [];
  if (config.foreignKeys && config.foreignKeys.length > 0) {
    for (const fk of config.foreignKeys) {
      try {
        // Call reference() to get the foreign key details
        const ref = (fk as { reference: () => unknown }).reference();
        const refDetails = ref as {
          columns: Array<{ name: string }>;
          foreignColumns: Array<{ name: string }>;
          foreignTable: PgTable;
        };

        const localColumns = refDetails.columns.map((c) => `"${c.name}"`).join(', ');
        const foreignColumns = refDetails.foreignColumns.map((c) => `"${c.name}"`).join(', ');

        // Get the foreign table name
        const foreignTableConfig = getTableConfig(refDetails.foreignTable);
        const foreignTableName = foreignTableConfig.name;

        let fkConstraint = `FOREIGN KEY (${localColumns}) REFERENCES "${foreignTableName}"(${foreignColumns})`;

        // Add ON DELETE and ON UPDATE clauses
        const fkWithOptions = fk as { onDelete?: string; onUpdate?: string };
        if (fkWithOptions.onDelete) {
          fkConstraint += ` ON DELETE ${fkWithOptions.onDelete.toUpperCase()}`;
        }

        if (fkWithOptions.onUpdate) {
          fkConstraint += ` ON UPDATE ${fkWithOptions.onUpdate.toUpperCase()}`;
        }

        foreignKeys.push(fkConstraint);
      } catch (error) {
        console.warn('Could not process foreign key:', error);
      }
    }
  }

  // Combine column definitions, unique constraints, and foreign keys
  const allConstraints = [...columns, ...uniqueConstraints, ...foreignKeys];

  // Create table SQL
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
        const columnNames = columns
          .map((col) => {
            const colName = (col as { name: string }).name;
            // Skip tsvector search column in PGlite
            if (colName === 'search') {
              return null;
            }
            return `"${colName}"`;
          })
          .filter((name) => name !== null)
          .join(', ');

        if (columnNames) {
          const indexSQL = `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${columnNames})`;
          indexSQLs.push(indexSQL);
        }
      }
    }
  }

  return indexSQLs;
}

/**
 * Creates enum types used in the schema
 */
async function createEnumTypes(db: PgliteDatabase<typeof schema>): Promise<void> {
  // Create log_level enum
  try {
    await db.execute(
      sql.raw(`
      DO $$ BEGIN
        CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error', 'fatal');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `),
    );
  } catch (error) {
    // Enum might already exist, ignore error
    console.warn('Could not create log_level enum:', error);
  }
}

/**
 * Creates triggers for generated columns (workaround for PGlite limitations)
 */
async function createTriggers(db: PgliteDatabase<typeof schema>): Promise<void> {
  // Create trigger function for log search tsvector
  try {
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION log_search_trigger() RETURNS trigger AS $$
      BEGIN
        NEW.search := setweight(to_tsvector('english', NEW.message), 'A') ||
                      setweight(to_tsvector('english', COALESCE(NEW.body::text, '')), 'B') ||
                      setweight(to_tsvector('english', COALESCE(NEW.metadata::text, '')), 'B') ||
                      setweight(to_tsvector('english', COALESCE(NEW.resource_attributes::text, '')), 'C') ||
                      setweight(to_tsvector('english', COALESCE(NEW.scope_attributes::text, '')), 'C');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `),
    );

    // Create trigger on log table
    await db.execute(
      sql.raw(`
      CREATE TRIGGER log_search_update
      BEFORE INSERT OR UPDATE ON log
      FOR EACH ROW EXECUTE FUNCTION log_search_trigger();
    `),
    );
  } catch (error) {
    // Trigger might already exist, ignore error
    console.warn('Could not create log search trigger:', error);
  }
}

/**
 * Creates an in-memory PGlite database for testing with dynamic schema application
 */
export async function createTestDatabase(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  // Create enum types first
  await createEnumTypes(db);

  // Create tables in dependency order to handle foreign keys
  // Order: user -> project/session/account/verification -> log
  const tableOrder = [
    'user', // No dependencies
    'project', // No dependencies
    'incident', // Depends on project
    'session', // Depends on user
    'account', // Depends on user
    'verification', // No dependencies
    'log', // Depends on project + incident
  ];

  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  for (const tableName of tableOrder) {
    const table = tables.find((t) => {
      const config = getTableConfig(t as PgTable);
      return config.name === tableName;
    });

    if (table) {
      // Create table
      const createSQL = generateCreateTableSQL(table as PgTable);
      await db.execute(sql.raw(createSQL));

      // Create indexes
      const indexSQLs = generateIndexSQL(table as PgTable);
      for (const indexSQL of indexSQLs) {
        await db.execute(sql.raw(indexSQL));
      }
    }
  }

  // Create triggers for generated columns
  await createTriggers(db);

  return db;
}

/**
 * Cleans all tables in the test database by truncating them dynamically
 */
export async function cleanDatabase(db: PgliteDatabase<typeof schema>): Promise<void> {
  // Get all table names from schema
  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  // Truncate all tables in reverse order to handle foreign keys
  const tableNames = tables.map((table) => {
    const config = getTableConfig(table as PgTable);
    return config.name;
  });

  // Reverse to handle cascades properly
  for (const tableName of tableNames.reverse()) {
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
