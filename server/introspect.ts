// Reverse engineering: read a live database's catalog and build a model.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyModel, newColumn, uid, type ConnectionConfig, type DataModel, type RefAction, type Table } from "../shared/types.ts";
import { DATA_DIR } from "./store.ts";

interface RawColumn {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
  autoIncrement?: boolean;
  comment?: string | null;
}
interface RawTable {
  schema?: string;
  name: string;
  comment?: string | null;
  rows?: number | null;
  columns: RawColumn[];
  pk: string[];
  uniques: { name: string; columns: string[] }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
}
interface RawFk {
  name?: string;
  schema?: string;
  table: string;
  columns: string[];
  refSchema?: string;
  refTable: string;
  refColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}
interface Raw {
  tables: RawTable[];
  fks: RawFk[];
}

function refAction(s?: string | null): RefAction | undefined {
  const v = (s ?? "").toUpperCase().replace(/_/g, " ");
  return v === "CASCADE" || v === "SET NULL" || v === "RESTRICT" ? v : undefined;
}

function build(raw: Raw, cfg: ConnectionConfig, name: string): DataModel {
  const model = emptyModel(name, cfg.dialect);
  model.description = `Reverse engineered from ${cfg.dialect} database "${name}"`;
  const tkey = (schema: string | undefined, table: string) => `${schema ?? ""}.${table}`.toLowerCase();
  const byKey = new Map<string, Table>();
  const cols = Math.max(1, Math.ceil(Math.sqrt(raw.tables.length)));

  raw.tables.forEach((rt, i) => {
    const t: Table = {
      id: uid("t_"),
      name: rt.name,
      schema: rt.schema,
      comment: rt.comment || undefined,
      rowCount: rt.rows != null && Number(rt.rows) >= 0 ? Number(rt.rows) : undefined,
      columns: rt.columns.map((c) =>
        newColumn({
          name: c.name,
          type: c.type,
          nullable: c.nullable && !rt.pk.includes(c.name),
          primaryKey: rt.pk.includes(c.name),
          unique: rt.uniques.some((u) => u.columns.length === 1 && u.columns[0] === c.name),
          autoIncrement: !!c.autoIncrement,
          default: c.default ?? undefined,
          comment: c.comment || undefined,
        }),
      ),
      indexes: [],
      position: { x: 60 + (i % cols) * 340, y: 60 + Math.floor(i / cols) * 320 },
    };
    const id = (n: string) => t.columns.find((c) => c.name === n)?.id;
    const add = (ixName: string, names: string[], unique: boolean) => {
      const ids = names.map(id);
      if (ids.length && ids.every(Boolean)) t.indexes.push({ id: uid("i_"), name: ixName, columns: ids as string[], unique });
    };
    rt.uniques.filter((u) => u.columns.length > 1).forEach((u) => add(u.name, u.columns, true));
    rt.indexes.forEach((ix) => add(ix.name, ix.columns, ix.unique));
    model.tables.push(t);
    byKey.set(tkey(rt.schema, rt.name), t);
  });

  for (const fk of raw.fks) {
    const child = byKey.get(tkey(fk.schema, fk.table));
    const parent = byKey.get(tkey(fk.refSchema ?? fk.schema, fk.refTable));
    if (!child || !parent) continue;
    const from = fk.columns.map((n) => child.columns.find((c) => c.name === n)?.id);
    const to = fk.refColumns.map((n) => parent.columns.find((c) => c.name === n)?.id);
    if (!from.every(Boolean) || !to.every(Boolean)) continue;
    model.relationships.push({
      id: uid("r_"),
      name: fk.name,
      fromTable: child.id,
      fromColumns: from as string[],
      toTable: parent.id,
      toColumns: to as string[],
      onDelete: refAction(fk.onDelete),
      onUpdate: refAction(fk.onUpdate),
    });
  }
  return model;
}

function group<T>(rows: T[], keyOf: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

// ---------------------------------------------------------------- PostgreSQL

async function postgres(cfg: ConnectionConfig): Promise<Raw> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    host: cfg.host || "localhost",
    port: cfg.port || 5432,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  try {
    const schema = cfg.schema || null;
    const where = `n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_%' AND ($1::text IS NULL OR n.nspname = $1)`;
    const agg = (arr: string, rel: string) =>
      `(SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(${arr}) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = ${rel} AND a.attnum = k.attnum)`;
    const columns = await client.query(
      `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS "column", format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS "default", a.attidentity <> '' AS identity,
              col_description(c.oid, a.attnum) AS comment, obj_description(c.oid) AS table_comment, c.reltuples::bigint AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
       WHERE c.relkind IN ('r','p') AND ${where}
       ORDER BY n.nspname, c.relname, a.attnum`,
      [schema],
    );
    const cons = await client.query(
      `SELECT n.nspname AS schema, c.relname AS "table", con.conname AS name, con.contype AS type,
              ${agg("con.conkey", "con.conrelid")} AS columns,
              fn.nspname AS ref_schema, fc.relname AS ref_table,
              ${agg("con.confkey", "con.confrelid")} AS ref_columns,
              con.confdeltype AS del, con.confupdtype AS upd
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_class fc ON fc.oid = con.confrelid LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
       WHERE con.contype IN ('p','u','f') AND ${where}`,
      [schema],
    );
    const idx = await client.query(
      `SELECT n.nspname AS schema, c.relname AS "table", i.relname AS name, ix.indisunique AS "unique",
              ${agg("ix.indkey::int2[]", "c.oid")} AS columns
       FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class c ON c.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT ix.indisprimary AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid) AND ${where}`,
      [schema],
    );
    const k = (r: Record<string, any>) => `${r.schema}.${r.table}`;
    const consBy = group(cons.rows, k), idxBy = group(idx.rows, k);
    const act: Record<string, string> = { c: "CASCADE", n: "SET NULL", r: "RESTRICT" };
    const tables: RawTable[] = [...group(columns.rows, k).entries()].map(([key, rows]) => {
      const tc = consBy.get(key) ?? [];
      return {
        schema: rows[0].schema,
        name: rows[0].table,
        comment: rows[0].table_comment,
        rows: rows[0].rows,
        columns: rows.map((r) => {
          const serial = typeof r.default === "string" && r.default.startsWith("nextval(");
          // Show the short type names people write, and drop the cast Postgres appends to literal defaults.
          const type = String(r.type)
            .replace(/^character varying/, "varchar")
            .replace(/^character\b/, "char")
            .replace(/^timestamp(\(\d+\))? without time zone$/, "timestamp$1")
            .replace(/^timestamp(\(\d+\))? with time zone$/, "timestamptz$1")
            .replace(/^time(\(\d+\))? without time zone$/, "time$1");
          const def = serial || r.default == null ? null : String(r.default).replace(/^('(?:[^']|'')*')::[\w\s"().\[\]]+$/, "$1");
          return { name: r.column, type, nullable: !r.notnull, default: def, autoIncrement: serial || r.identity, comment: r.comment };
        }),
        pk: tc.find((c) => c.type === "p")?.columns ?? [],
        uniques: tc.filter((c) => c.type === "u").map((c) => ({ name: c.name, columns: c.columns ?? [] })),
        indexes: (idxBy.get(key) ?? []).filter((i) => i.columns?.length).map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
      };
    });
    const fks: RawFk[] = cons.rows
      .filter((c) => c.type === "f")
      .map((c) => ({
        name: c.name, schema: c.schema, table: c.table, columns: c.columns ?? [],
        refSchema: c.ref_schema, refTable: c.ref_table, refColumns: c.ref_columns ?? [],
        onDelete: act[c.del], onUpdate: act[c.upd],
      }));
    return { tables, fks };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------- MySQL

async function mysql(cfg: ConnectionConfig): Promise<Raw> {
  const { default: mysql2 } = await import("mysql2/promise");
  const conn = await mysql2.createConnection({
    host: cfg.host || "localhost",
    port: cfg.port || 3306,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10000,
  });
  try {
    const db = cfg.database;
    const rows = async (sql: string) => (await conn.query(sql, [db]))[0] as Record<string, any>[];
    const columns = await rows(
      `SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS c, c.COLUMN_TYPE AS type, c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS def,
              c.EXTRA AS extra, c.COLUMN_COMMENT AS comment, t.TABLE_COMMENT AS table_comment, t.TABLE_ROWS AS table_rows
       FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
       WHERE c.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE' ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    );
    const stats = await rows(
      `SELECT TABLE_NAME AS t, INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS c
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    );
    const fkRows = await rows(
      `SELECT k.CONSTRAINT_NAME AS name, k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rc,
              r.DELETE_RULE AS del, r.UPDATE_RULE AS upd
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    );
    const statsBy = group(stats, (r) => r.t);
    const tables: RawTable[] = [...group(columns, (r) => r.t).entries()].map(([name, cols]) => {
      const ix = [...group(statsBy.get(name) ?? [], (r) => r.name).entries()].map(([n, r]) => ({ name: n, columns: r.map((x) => x.c), unique: !Number(r[0].non_unique) }));
      return {
        name,
        comment: cols[0].table_comment,
        rows: cols[0].table_rows,
        columns: cols.map((r) => {
          const generated = /DEFAULT_GENERATED/i.test(r.extra ?? "");
          const def = r.def == null ? null : generated || /^-?\d+(\.\d+)?$/.test(r.def) || /^current_timestamp/i.test(r.def) ? String(r.def) : `'${String(r.def).replace(/'/g, "''")}'`;
          return { name: r.c, type: r.type, nullable: r.nullable === "YES", default: def, autoIncrement: /auto_increment/i.test(r.extra ?? ""), comment: r.comment };
        }),
        pk: ix.find((i) => i.name === "PRIMARY")?.columns ?? [],
        uniques: ix.filter((i) => i.unique && i.name !== "PRIMARY" && i.columns.length === 1),
        indexes: ix.filter((i) => i.name !== "PRIMARY" && !(i.unique && i.columns.length === 1)),
      };
    });
    const fks: RawFk[] = [...group(fkRows, (r) => `${r.t}.${r.name}`).values()].map((r) => ({
      name: r[0].name, table: r[0].t, columns: r.map((x) => x.c), refTable: r[0].rt, refColumns: r.map((x) => x.rc), onDelete: r[0].del, onUpdate: r[0].upd,
    }));
    return { tables, fks };
  } finally {
    await conn.end();
  }
}

// ---------------------------------------------------------------- SQL Server

async function sqlserver(cfg: ConnectionConfig): Promise<Raw> {
  const { default: mssql } = await import("mssql");
  const pool = await new mssql.ConnectionPool({
    server: cfg.host || "localhost",
    port: cfg.port || 1433,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: { encrypt: !!cfg.ssl, trustServerCertificate: true },
    connectionTimeout: 10000,
  }).connect();
  try {
    const run = async (sql: string) => (await pool.request().input("schema", cfg.schema || null).query(sql)).recordset as Record<string, any>[];
    const where = `(@schema IS NULL OR s.name = @schema)`;
    const columns = await run(
      `SELECT s.name AS [schema], t.name AS [table], c.name AS [column], ty.name AS type, c.max_length, c.precision, c.scale,
              c.is_nullable, c.is_identity, dc.definition AS def,
              (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS table_rows
       FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id JOIN sys.columns c ON c.object_id = t.object_id
       JOIN sys.types ty ON ty.user_type_id = c.user_type_id LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
       WHERE t.is_ms_shipped = 0 AND ${where} ORDER BY s.name, t.name, c.column_id`,
    );
    const idx = await run(
      `SELECT s.name AS [schema], t.name AS [table], i.name, i.is_unique, i.is_primary_key, i.is_unique_constraint, c.name AS [column]
       FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.name IS NOT NULL AND t.is_ms_shipped = 0 AND ${where} ORDER BY s.name, t.name, i.name, ic.key_ordinal`,
    );
    const fkRows = await run(
      `SELECT fk.name, s.name AS [schema], t.name AS [table], c.name AS [column], rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_column,
              fk.delete_referential_action_desc AS del, fk.update_referential_action_desc AS upd
       FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.tables t ON t.object_id = fk.parent_object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
       JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
       JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE ${where} ORDER BY fk.name, fkc.constraint_column_id`,
    );
    const typeOf = (r: Record<string, any>) => {
      const t = r.type as string;
      if (/^n?(var)?char$|^(var)?binary$/.test(t)) return `${t}(${r.max_length === -1 ? "max" : t.startsWith("n") ? r.max_length / 2 : r.max_length})`;
      if (/^(decimal|numeric)$/.test(t)) return `${t}(${r.precision},${r.scale})`;
      return t;
    };
    const k = (r: Record<string, any>) => `${r.schema}.${r.table}`;
    const idxBy = group(idx, k);
    const tables: RawTable[] = [...group(columns, k).entries()].map(([key, cols]) => {
      const ix = [...group(idxBy.get(key) ?? [], (r) => r.name).entries()].map(([n, r]) => ({
        name: n, columns: r.map((x) => x.column), unique: !!r[0].is_unique, pk: !!r[0].is_primary_key, uc: !!r[0].is_unique_constraint,
      }));
      return {
        schema: cols[0].schema,
        name: cols[0].table,
        rows: cols[0].table_rows,
        columns: cols.map((r) => ({ name: r.column, type: typeOf(r), nullable: !!r.is_nullable, default: r.def ? String(r.def).replace(/^\((.*)\)$/, "$1") : null, autoIncrement: !!r.is_identity })),
        pk: ix.find((i) => i.pk)?.columns ?? [],
        uniques: ix.filter((i) => i.uc),
        indexes: ix.filter((i) => !i.pk && !i.uc),
      };
    });
    const fks: RawFk[] = [...group(fkRows, (r) => `${r.schema}.${r.name}`).values()].map((r) => ({
      name: r[0].name, schema: r[0].schema, table: r[0].table, columns: r.map((x) => x.column),
      refSchema: r[0].ref_schema, refTable: r[0].ref_table, refColumns: r.map((x) => x.ref_column), onDelete: r[0].del, onUpdate: r[0].upd,
    }));
    return { tables, fks };
  } finally {
    await pool.close();
  }
}

// ---------------------------------------------------------------- SQLite

function sqlite(cfg: ConnectionConfig): Raw {
  if (!cfg.file) throw new Error("Enter the path to a SQLite database file");
  if (!fs.existsSync(cfg.file)) throw new Error(`File not found: ${cfg.file}`);
  const db = new DatabaseSync(cfg.file, { readOnly: true });
  try {
    const qi = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    const all = (sql: string) => db.prepare(sql).all() as Record<string, any>[];
    const tables: RawTable[] = [];
    const fks: RawFk[] = [];
    for (const t of all(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)) {
      const info = all(`PRAGMA table_info(${qi(t.name)})`);
      const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      const autoinc = /AUTOINCREMENT/i.test(t.sql ?? "");
      const ix = all(`PRAGMA index_list(${qi(t.name)})`).map((i) => ({
        name: i.name as string, unique: !!i.unique, origin: i.origin as string,
        columns: all(`PRAGMA index_info(${qi(i.name)})`).map((c) => c.name).filter(Boolean),
      }));
      tables.push({
        name: t.name,
        rows: Number(all(`SELECT COUNT(*) AS n FROM ${qi(t.name)}`)[0].n),
        columns: info.map((c) => ({
          name: c.name, type: (c.type || "text").toLowerCase(), nullable: !c.notnull, default: c.dflt_value,
          autoIncrement: autoinc && pk.length === 1 && pk[0] === c.name,
        })),
        pk,
        uniques: ix.filter((i) => i.origin === "u"),
        indexes: ix.filter((i) => i.origin === "c" && i.columns.length),
      });
      for (const rows of group(all(`PRAGMA foreign_key_list(${qi(t.name)})`), (r) => String(r.id)).values()) {
        rows.sort((a, b) => a.seq - b.seq);
        fks.push({ table: t.name, columns: rows.map((r) => r.from), refTable: rows[0].table, refColumns: rows.map((r) => r.to), onDelete: rows[0].on_delete, onUpdate: rows[0].on_update });
      }
    }
    // A foreign key that omits the parent column list refers to the parent's primary key.
    for (const fk of fks) {
      if (fk.refColumns.some((c) => !c)) fk.refColumns = tables.find((t) => t.name === fk.refTable)?.pk ?? [];
    }
    return { tables, fks };
  } finally {
    db.close();
  }
}

export async function introspect(cfg: ConnectionConfig): Promise<DataModel> {
  const raw =
    cfg.dialect === "postgres" ? await postgres(cfg)
    : cfg.dialect === "mysql" ? await mysql(cfg)
    : cfg.dialect === "sqlserver" ? await sqlserver(cfg)
    : sqlite(cfg);
  const name = cfg.dialect === "sqlite" ? path.basename(cfg.file ?? "sqlite", path.extname(cfg.file ?? "")) : cfg.database || cfg.dialect;
  return build(raw, cfg, name);
}

// ---------------------------------------------------------------- sample database

export const SAMPLE_DB = path.join(DATA_DIR, "samples", "shop.db");

export function ensureSampleDb() {
  if (fs.existsSync(SAMPLE_DB)) return;
  fs.mkdirSync(path.dirname(SAMPLE_DB), { recursive: true });
  const db = new DatabaseSync(SAMPLE_DB);
  db.exec(`
    CREATE TABLE customers (
      id integer PRIMARY KEY AUTOINCREMENT,
      email varchar(255) NOT NULL UNIQUE,
      full_name varchar(120) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE categories (
      id integer PRIMARY KEY AUTOINCREMENT,
      name varchar(80) NOT NULL,
      parent_id integer REFERENCES categories(id)
    );
    CREATE TABLE products (
      id integer PRIMARY KEY AUTOINCREMENT,
      sku varchar(40) NOT NULL UNIQUE,
      name varchar(200) NOT NULL,
      price numeric(10,2) NOT NULL,
      category_id integer REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE TABLE orders (
      id integer PRIMARY KEY AUTOINCREMENT,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      status varchar(20) NOT NULL DEFAULT 'pending',
      total numeric(12,2) NOT NULL DEFAULT 0,
      placed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE order_items (
      order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id integer NOT NULL REFERENCES products(id),
      quantity integer NOT NULL DEFAULT 1,
      unit_price numeric(10,2) NOT NULL,
      PRIMARY KEY (order_id, product_id)
    );
    CREATE INDEX ix_orders_customer ON orders (customer_id);
    CREATE INDEX ix_products_category ON products (category_id);
  `);
  db.close();
}
