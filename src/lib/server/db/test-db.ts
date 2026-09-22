import { PGlite } from "@electric-sql/pglite";
import { is, sql, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { z } from "zod";
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
    const generated = column.generated;

    if (isCustomType || isEnumType) {
      // Both column classes expose their real Postgres type through getSQLType():
      // custom columns return their dataType() (e.g. tsvector), PgEnumColumn
      // returns the enum factory's name (e.g. log_level). The name is NOT a
      // property of the column (reading `enumName` off it yields undefined and
      // silently degrades the column to TEXT).
      parts.push(column.getSQLType());
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
        const withTimezone = "withTimezone" in column ? column.withTimezone : undefined;

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

    if (generated) {
      // `as` is the SQL expression, a thunk returning it, or a raw column-type
      // string; PgDialect renders the SQL form with the columns qualified.
      const as = generated.as instanceof Function ? generated.as() : generated.as;
      const expression = is(as, SQL) ? new PgDialect().sqlToQuery(as).sql : String(as);
      parts.push(`GENERATED ALWAYS AS (${expression}) STORED`);
    }

    if (column.notNull) {
      parts.push("NOT NULL");
    }

    if (column.primary) {
      parts.push("PRIMARY KEY");
    }

    if (column.hasDefault && !generated) {
      if (column.dataType === "date") {
        const defaultFn = column.default;

        if (defaultFn) {
          parts.push("DEFAULT NOW()");
        }
      } else if (column.dataType === "boolean") {
        const defaultValue = column.default;

        if (defaultValue !== undefined) {
          const value =
            defaultValue instanceof Object && "value" in defaultValue
              ? defaultValue.value
              : defaultValue;

          parts.push(`DEFAULT ${String(value)}`);
        }
      } else if (column.default !== undefined) {
        const rawDefault = column.default;

        const defaultValue =
          rawDefault instanceof Object && "value" in rawDefault ? rawDefault.value : rawDefault;

        if (defaultValue instanceof Object && "sql" in defaultValue) {
          const sqlValue = String(defaultValue.sql);
          parts.push(`DEFAULT ${sqlValue}`);
        } else if (z.string().safeParse(defaultValue).success) {
          parts.push(`DEFAULT '${String(defaultValue)}'`);
        } else if (Number.isFinite(defaultValue)) {
          parts.push(`DEFAULT ${String(defaultValue)}`);
        } else if (defaultValue === true || defaultValue === false) {
          parts.push(`DEFAULT ${String(defaultValue)}`);
        }
      }
    }

    if (column.isUnique) {
      // drizzle-kit names column-level uniques "<table>_<column>_unique"; the test
      // DB must match, since error handling keys off constraint names.
      const uniqueName = column.uniqueName ?? `${tableName}_${column.name}_unique`;
      uniqueConstraints.push(`CONSTRAINT "${uniqueName}" UNIQUE("${column.name}")`);
    }

    columns.push(parts.join(" "));
  }

  const foreignKeys: string[] = [];

  if (config.foreignKeys && config.foreignKeys.length > 0) {
    for (const fk of config.foreignKeys) {
      try {
        const ref = fk.reference();

        const localColumns = ref.columns.map((c) => `"${c.name}"`).join(", ");
        const foreignColumns = ref.foreignColumns.map((c) => `"${c.name}"`).join(", ");

        const foreignTableConfig = getTableConfig(ref.foreignTable);
        const foreignTableName = foreignTableConfig.name;

        let fkConstraint = `FOREIGN KEY (${localColumns}) REFERENCES "${foreignTableName}"(${foreignColumns})`;

        if (fk.onDelete) {
          fkConstraint += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
        }

        if (fk.onUpdate) {
          fkConstraint += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
        }

        foreignKeys.push(fkConstraint);
      } catch (error) {
        console.warn("Could not process foreign key:", error);
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

  for (const index of config.indexes ?? []) {
    const indexConfig = index.config;

    if (!indexConfig.name || !indexConfig.columns?.length) continue;

    const columnNames = indexConfig.columns
      .map((col) => `"${"name" in col ? col.name : undefined}"`)
      .join(", ");

    const unique = indexConfig.unique ? "UNIQUE " : "";
    indexSQLs.push(
      `CREATE ${unique}INDEX IF NOT EXISTS "${indexConfig.name}" ON "${tableName}" USING ${indexConfig.method ?? "btree"} (${columnNames})`,
    );
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

export async function createTestDatabase(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await createEnumTypes(db);

  const tableOrder = ["user", "project", "incident", "session", "account", "verification", "log"];

  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  for (const tableName of tableOrder) {
    const table = tables.find((t) => {
      const config = getTableConfig(t);

      return config.name === tableName;
    });

    if (table) {
      const createSQL = generateCreateTableSQL(table);
      await db.execute(sql.raw(createSQL));

      const indexSQLs = generateIndexSQL(table);

      for (const indexSQL of indexSQLs) {
        await db.execute(sql.raw(indexSQL));
      }
    }
  }

  return db;
}

export async function cleanDatabase(db: PgliteDatabase<typeof schema>): Promise<void> {
  const tables = Object.values(schema).filter((item) => is(item, PgTable));

  const tableNames = tables.map((table) => {
    const config = getTableConfig(table);

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
