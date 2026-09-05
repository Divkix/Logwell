import { PGlite } from "@electric-sql/pglite";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

function generateCreateTableSQL(table: PgTable): string {
  const config = getTableConfig(table);
  const tableName = config.name;
  const columns: string[] = [];
  const uniqueConstraints: string[] = [];

  for (const column of config.columns) {
    const parts: string[] = [`"${column.name}"`];

    const columnType = column.columnType;
    const isCustomType = columnType === "PgCustomColumn";
    const isEnumType = columnType === "PgEnumColumn";
    const isGeneratedColumn = (column as { generated?: unknown }).generated !== undefined;

    if (isCustomType) {
      const customColumn = column as unknown as { getSQLType?: () => string };
      if (customColumn.getSQLType) {
        parts.push(customColumn.getSQLType());
      } else {
        parts.push("TSVECTOR");
      }
    } else if (isEnumType) {
      const enumColumn = column as unknown as { enumName?: string };
      if (enumColumn.enumName) {
        parts.push(enumColumn.enumName);
      } else {
        parts.push("TEXT");
      }
    } else if (column.dataType === "number") {
      if (column.columnType === "PgSerial") {
        parts.push("SERIAL");
      } else {
        parts.push("INTEGER");
      }
    } else if (column.dataType === "string") {
      if (column.columnType.includes("Text")) {
        parts.push("TEXT");
      } else if (column.columnType.includes("Varchar")) {
        parts.push("VARCHAR(255)");
      } else {
        parts.push("TEXT");
      }
    } else if (column.dataType === "boolean") {
      parts.push("BOOLEAN");
    } else if (column.dataType === "date") {
      if (column.columnType === "PgTimestamp") {
        const withTimezone = (column as unknown as { withTimezone?: boolean }).withTimezone;
        if (withTimezone) {
          parts.push("TIMESTAMPTZ");
        } else {
          parts.push("TIMESTAMP");
        }
      } else {
        parts.push("TIMESTAMP");
      }
    } else if (column.dataType === "json") {
      parts.push("JSONB");
    } else {
      parts.push("TEXT");
    }

    if (isGeneratedColumn) {
      const generated = (column as { generated?: { as: unknown; type?: string } }).generated;
      if (generated && generated.type === "stored") {
        continue;
      }
    }

    if (column.notNull) {
      parts.push("NOT NULL");
    }

    if (column.primary) {
      parts.push("PRIMARY KEY");
    }

    if (column.hasDefault && !isGeneratedColumn) {
      if (column.dataType === "date") {
        const defaultFn = (column as unknown as { default?: unknown }).default;
        if (defaultFn) {
          parts.push("DEFAULT NOW()");
        }
      } else if (column.dataType === "boolean") {
        const defaultValue = (column as unknown as { default?: unknown }).default;
        if (defaultValue !== undefined) {
          const value =
            typeof defaultValue === "object" && defaultValue !== null && "value" in defaultValue
              ? (defaultValue as { value: unknown }).value
              : defaultValue;
          parts.push(`DEFAULT ${String(value)}`);
        }
      } else if (column.default !== undefined) {
        const rawDefault = column.default;
        const defaultValue =
          typeof rawDefault === "object" && rawDefault !== null && "value" in rawDefault
            ? (rawDefault as { value?: unknown }).value
            : rawDefault;
        if (defaultValue && typeof defaultValue === "object" && "sql" in defaultValue) {
          const sqlValue = (defaultValue as { sql?: string }).sql;
          parts.push(`DEFAULT ${sqlValue}`);
        } else if (typeof defaultValue === "string") {
          parts.push(`DEFAULT '${defaultValue}'`);
        } else if (typeof defaultValue === "number") {
          parts.push(`DEFAULT ${defaultValue}`);
        } else if (typeof defaultValue === "boolean") {
          parts.push(`DEFAULT ${defaultValue}`);
        }
      }
    }

    if (column.isUnique) {
      uniqueConstraints.push(`UNIQUE("${column.name}")`);
    }

    columns.push(parts.join(" "));
  }

  const foreignKeys: string[] = [];
  if (config.foreignKeys && config.foreignKeys.length > 0) {
    for (const fk of config.foreignKeys) {
      try {
        const ref = (fk as { reference: () => unknown }).reference();
        const refDetails = ref as {
          columns: Array<{ name: string }>;
          foreignColumns: Array<{ name: string }>;
          foreignTable: PgTable;
        };

        const localColumns = refDetails.columns.map((c) => `"${c.name}"`).join(", ");
        const foreignColumns = refDetails.foreignColumns.map((c) => `"${c.name}"`).join(", ");

        const foreignTableConfig = getTableConfig(refDetails.foreignTable);
        const foreignTableName = foreignTableConfig.name;

        let fkConstraint = `FOREIGN KEY (${localColumns}) REFERENCES "${foreignTableName}"(${foreignColumns})`;

        const fkWithOptions = fk as { onDelete?: string; onUpdate?: string };
        if (fkWithOptions.onDelete) {
          fkConstraint += ` ON DELETE ${fkWithOptions.onDelete.toUpperCase()}`;
        }

        if (fkWithOptions.onUpdate) {
          fkConstraint += ` ON UPDATE ${fkWithOptions.onUpdate.toUpperCase()}`;
        }

        foreignKeys.push(fkConstraint);
      } catch (error) {
        console.warn("Could not process foreign key:", error);
      }
    }
  }

  if (config.indexes) {
    for (const [_, index] of Object.entries(config.indexes)) {
      const indexConfig = (
        index as unknown as { config?: { unique?: boolean; columns?: unknown[] } }
      ).config;
      if (indexConfig?.unique && indexConfig.columns && indexConfig.columns.length > 0) {
        const columnNames = indexConfig.columns
          .map((col) => {
            const colName = (col as { name: string }).name;
            return colName ? `"${colName}"` : null;
          })
          .filter((name): name is string => name !== null)
          .join(", ");
        if (columnNames) {
          uniqueConstraints.push(`UNIQUE(${columnNames})`);
        }
      }
    }
  }

  const allConstraints = [...columns, ...uniqueConstraints, ...foreignKeys];

  const createTableSQL = `CREATE TABLE IF NOT EXISTS "${tableName}" (${allConstraints.join(", ")})`;

  return createTableSQL;
}

function generateIndexSQL(table: PgTable): string[] {
  const config = getTableConfig(table);
  const tableName = config.name;
  const indexSQLs: string[] = [];

  if (config.indexes) {
    for (const [indexName, index] of Object.entries(config.indexes)) {
      const columns = (index as unknown as { config?: { columns?: unknown[] } }).config?.columns;
      if (columns && columns.length > 0) {
        const columnNames = columns
          .map((col) => {
            const colName = (col as { name: string }).name;
            if (colName === "search") {
              return null;
            }
            return `"${colName}"`;
          })
          .filter((name) => name !== null)
          .join(", ");

        if (columnNames) {
          const isUnique = (index as unknown as { config?: { unique?: boolean } }).config?.unique;
          if (isUnique) continue;
          const indexSQL = `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${columnNames})`;
          indexSQLs.push(indexSQL);
        }
      }
    }
  }

  return indexSQLs;
}

async function createEnumTypes(db: PgliteDatabase<typeof schema>): Promise<void> {
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
    console.warn("Could not create log_level enum:", error);
  }
}

async function createTriggers(db: PgliteDatabase<typeof schema>): Promise<void> {
  try {
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION log_search_trigger() RETURNS trigger AS $$
      BEGIN
        -- NOTE: keep this expression in sync with the generatedAlwaysAs in schema.ts
        -- and the migration that recreates the column (drizzle/0010_*.sql).
        -- Uses || + COALESCE (not concat_ws) to match the IMMUTABLE expression
        -- required by the Postgres STORED generated column.
        NEW.search := to_tsvector('english',
          COALESCE(NEW.message, '') || ' ' ||
          COALESCE(NEW.body::text, '') || ' ' ||
          COALESCE(NEW.metadata::text, '') || ' ' ||
          COALESCE(NEW.resource_attributes::text, '') || ' ' ||
          COALESCE(NEW.scope_attributes::text, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `),
    );

    await db.execute(
      sql.raw(`
      CREATE TRIGGER log_search_update
      BEFORE INSERT OR UPDATE ON log
      FOR EACH ROW EXECUTE FUNCTION log_search_trigger();
    `),
    );
  } catch (error) {
    console.warn("Could not create log search trigger:", error);
  }
}

export async function createTestDatabase(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await createEnumTypes(db);

  const tableOrder = ["user", "project", "incident", "session", "account", "verification", "log"];

  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  for (const tableName of tableOrder) {
    const table = tables.find((t) => {
      const config = getTableConfig(t as PgTable);
      return config.name === tableName;
    });

    if (table) {
      const createSQL = generateCreateTableSQL(table as PgTable);
      await db.execute(sql.raw(createSQL));

      const indexSQLs = generateIndexSQL(table as PgTable);
      for (const indexSQL of indexSQLs) {
        await db.execute(sql.raw(indexSQL));
      }
    }
  }

  await createTriggers(db);

  return db;
}

export async function cleanDatabase(db: PgliteDatabase<typeof schema>): Promise<void> {
  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  const tableNames = tables.map((table) => {
    const config = getTableConfig(table as PgTable);
    return config.name;
  });

  for (const tableName of tableNames.reverse()) {
    try {
      await db.execute(sql.raw(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`));
    } catch (error) {
      console.warn(`Could not truncate table ${tableName}:`, error);
    }
  }
}

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
