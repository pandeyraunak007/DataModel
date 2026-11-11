// Forward engineering: model JSON -> DDL for a target dialect.
import type { Column, DataModel, Dialect, Index, Relationship, Table } from "./types.ts";

const RESERVED = new Set(
  "user order group table select where from index key primary references check default column constraint desc asc limit offset grant role end begin transaction values current date time timestamp level comment schema database view rank row rows".split(
    " ",
  ),
);

export function q(d: Dialect, name: string): string {
  const simple = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase());
  if (simple) return name;
  if (d === "mysql") return "`" + name.replace(/`/g, "``") + "`";
  if (d === "sqlserver") return "[" + name.replace(/]/g, "]]") + "]";
  return '"' + name.replace(/"/g, '""') + '"';
}

export function tableRef(d: Dialect, t: Pick<Table, "name" | "schema">): string {
  // SQLite has no schemas; a source schema like "public"/"dbo" rarely exists in another engine.
  if (!t.schema || d === "sqlite") return q(d, t.name);
  return q(d, t.schema) + "." + q(d, t.name);
}

/** Lower-cased, alias-normalised type used to compare types across sources. */
export function normalizeType(type: string): string {
  let t = type.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\(\s*/g, "(").replace(/\s*,\s*/g, ",").replace(/\s*\)/g, ")");
  const aliases: [RegExp, string][] = [
    [/^character varying/, "varchar"],
    [/^character\b/, "char"],
    [/^bpchar/, "char"],
    [/^int4$|^int$/, "integer"],
    [/^int8$/, "bigint"],
    [/^int2$/, "smallint"],
    [/^bool$/, "boolean"],
    [/^decimal/, "numeric"],
    [/^float8$|^double$/, "double precision"],
    [/^float4$/, "real"],
    [/^timestamp without time zone$/, "timestamp"],
    [/^timestamp with time zone$/, "timestamptz"],
    [/^time without time zone$/, "time"],
  ];
  for (const [re, to] of aliases) t = t.replace(re, to);
  return t;
}

type Kind =
  | "smallint" | "int" | "bigint" | "bool" | "varchar" | "char" | "text" | "numeric" | "float" | "double"
  | "date" | "time" | "timestamp" | "timestamptz" | "uuid" | "json" | "binary";

function classify(type: string): { kind: Kind; args: string } | null {
  const t = normalizeType(type);
  const m = t.match(/^([a-z_ 0-9]+?)(\((.*)\))?$/);
  if (!m) return null;
  const base = m[1].trim();
  const args = m[3] ?? "";
  const map: Record<string, Kind> = {
    smallint: "smallint", tinyint: "smallint", smallserial: "smallint",
    integer: "int", mediumint: "int", serial: "int",
    bigint: "bigint", bigserial: "bigint",
    boolean: "bool", bit: "bool",
    varchar: "varchar", nvarchar: "varchar", varchar2: "varchar", string: "varchar",
    char: "char", nchar: "char",
    text: "text", longtext: "text", mediumtext: "text", tinytext: "text", ntext: "text", clob: "text",
    numeric: "numeric", number: "numeric", money: "numeric",
    real: "float", float: "double", "double precision": "double",
    date: "date", time: "time",
    timestamp: "timestamp", datetime: "timestamp", datetime2: "timestamp", smalldatetime: "timestamp", timestamp_ntz: "timestamp",
    timestamptz: "timestamptz", datetimeoffset: "timestamptz", timestamp_tz: "timestamptz", timestamp_ltz: "timestamptz",
    uuid: "uuid", uniqueidentifier: "uuid",
    json: "json", jsonb: "json", variant: "json", object: "json",
    bytea: "binary", blob: "binary", longblob: "binary", varbinary: "binary", binary: "binary", image: "binary",
  };
  if (base === "tinyint" && args === "1") return { kind: "bool", args: "" };
  const kind = map[base];
  return kind ? { kind, args } : null;
}

/** Translate a column type between dialects. Unknown types pass through unchanged. */
export function mapType(type: string, from: Dialect, to: Dialect): string {
  if (from === to) return type;
  const c = classify(type);
  if (!c) return type;
  const a = c.args && c.args !== "max" ? `(${c.args})` : "";
  const len = a || "(255)";
  const table: Record<Kind, Record<Dialect, string>> = {
    smallint: { postgres: "smallint", mysql: "smallint", sqlserver: "smallint", sqlite: "integer", snowflake: "smallint" },
    int: { postgres: "integer", mysql: "int", sqlserver: "int", sqlite: "integer", snowflake: "integer" },
    bigint: { postgres: "bigint", mysql: "bigint", sqlserver: "bigint", sqlite: "integer", snowflake: "bigint" },
    bool: { postgres: "boolean", mysql: "tinyint(1)", sqlserver: "bit", sqlite: "integer", snowflake: "boolean" },
    varchar: { postgres: `varchar${len}`, mysql: `varchar${len}`, sqlserver: `nvarchar${len}`, sqlite: "text", snowflake: `varchar${len}` },
    char: { postgres: `char${a}`, mysql: `char${a}`, sqlserver: `nchar${a}`, sqlite: "text", snowflake: `char${a}` },
    text: { postgres: "text", mysql: "longtext", sqlserver: "nvarchar(max)", sqlite: "text", snowflake: "text" },
    numeric: { postgres: `numeric${a}`, mysql: `decimal${a}`, sqlserver: `decimal${a}`, sqlite: "numeric", snowflake: `number${a}` },
    float: { postgres: "real", mysql: "float", sqlserver: "real", sqlite: "real", snowflake: "float" },
    double: { postgres: "double precision", mysql: "double", sqlserver: "float", sqlite: "real", snowflake: "double" },
    date: { postgres: "date", mysql: "date", sqlserver: "date", sqlite: "text", snowflake: "date" },
    time: { postgres: "time", mysql: "time", sqlserver: "time", sqlite: "text", snowflake: "time" },
    timestamp: { postgres: "timestamp", mysql: "datetime", sqlserver: "datetime2", sqlite: "text", snowflake: "timestamp_ntz" },
    timestamptz: { postgres: "timestamptz", mysql: "timestamp", sqlserver: "datetimeoffset", sqlite: "text", snowflake: "timestamp_tz" },
    uuid: { postgres: "uuid", mysql: "char(36)", sqlserver: "uniqueidentifier", sqlite: "text", snowflake: "varchar(36)" },
    json: { postgres: "jsonb", mysql: "json", sqlserver: "nvarchar(max)", sqlite: "text", snowflake: "variant" },
    binary: { postgres: "bytea", mysql: "longblob", sqlserver: "varbinary(max)", sqlite: "blob", snowflake: "binary" },
  };
  return table[c.kind][to];
}

function isSerial(type: string) {
  return /^(small|big)?serial$/i.test(type.trim());
}

export function columnDef(col: Column, table: Table, from: Dialect, to: Dialect): string {
  const pkCols = table.columns.filter((c) => c.primaryKey);
  const solePk = pkCols.length === 1 && pkCols[0].id === col.id;
  let type = mapType(col.type, from, to);
  const parts = [q(to, col.name)];

  if (to === "sqlite" && col.autoIncrement && solePk) {
    return `${q(to, col.name)} integer PRIMARY KEY AUTOINCREMENT`;
  }
  if (col.autoIncrement && to === "postgres" && !isSerial(type)) {
    parts.push(type, "GENERATED BY DEFAULT AS IDENTITY");
  } else if (col.autoIncrement && to === "mysql") {
    parts.push(type, "AUTO_INCREMENT");
  } else if (col.autoIncrement && to === "sqlserver") {
    parts.push(type, "IDENTITY(1,1)");
  } else if (col.autoIncrement && to === "snowflake") {
    parts.push(type, "AUTOINCREMENT");
  } else {
    parts.push(type);
  }
  if (!col.nullable || col.primaryKey) parts.push("NOT NULL");
  if (col.default !== undefined && col.default !== "" && !col.autoIncrement) parts.push("DEFAULT " + col.default);
  if (col.unique && !solePk) parts.push("UNIQUE");
  if (col.comment && to === "mysql") parts.push(`COMMENT '${col.comment.replace(/'/g, "''")}'`);
  return parts.join(" ");
}

const names = (t: Table | undefined, ids: string[]) =>
  ids.map((id) => t?.columns.find((c) => c.id === id)?.name ?? "?");

export function fkClause(model: DataModel, r: Relationship, to: Dialect): string {
  const child = model.tables.find((t) => t.id === r.fromTable);
  const parent = model.tables.find((t) => t.id === r.toTable);
  const cname = r.name || `fk_${child?.name}_${names(child, r.fromColumns).join("_")}`;
  let s = `CONSTRAINT ${q(to, cname)} FOREIGN KEY (${names(child, r.fromColumns).map((n) => q(to, n)).join(", ")}) REFERENCES ${
    parent ? tableRef(to, parent) : "?"
  } (${names(parent, r.toColumns).map((n) => q(to, n)).join(", ")})`;
  if (r.onDelete && r.onDelete !== "NO ACTION") s += ` ON DELETE ${r.onDelete}`;
  if (r.onUpdate && r.onUpdate !== "NO ACTION") s += ` ON UPDATE ${r.onUpdate}`;
  return s;
}

export function fkSQL(model: DataModel, r: Relationship, to: Dialect): string {
  const child = model.tables.find((t) => t.id === r.fromTable);
  return `ALTER TABLE ${child ? tableRef(to, child) : "?"} ADD ${fkClause(model, r, to)};`;
}

export function indexSQL(table: Table, ix: Index, to: Dialect): string {
  return `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${q(to, ix.name)} ON ${tableRef(to, table)} (${names(table, ix.columns)
    .map((n) => q(to, n))
    .join(", ")});`;
}

export function createTableSQL(model: DataModel, table: Table, to: Dialect): string {
  const from = model.dialect;
  const lines = table.columns.map((c) => "  " + columnDef(c, table, from, to));
  const pk = table.columns.filter((c) => c.primaryKey);
  const inlinePk = to === "sqlite" && pk.length === 1 && pk[0].autoIncrement;
  if (pk.length && !inlinePk) {
    lines.push(`  CONSTRAINT ${q(to, "pk_" + table.name)} PRIMARY KEY (${pk.map((c) => q(to, c.name)).join(", ")})`);
  }
  if (to === "sqlite") {
    for (const r of model.relationships.filter((r) => r.fromTable === table.id)) lines.push("  " + fkClause(model, r, to));
  }
  let sql = `CREATE TABLE ${tableRef(to, table)} (\n${lines.join(",\n")}\n)`;
  if (table.comment && to === "mysql") sql += ` COMMENT='${table.comment.replace(/'/g, "''")}'`;
  sql += ";";
  const extra: string[] = [];
  if (to === "postgres" || to === "snowflake") {
    const esc = (s: string) => s.replace(/'/g, "''");
    if (table.comment) extra.push(`COMMENT ON TABLE ${tableRef(to, table)} IS '${esc(table.comment)}';`);
    for (const c of table.columns)
      if (c.comment) extra.push(`COMMENT ON COLUMN ${tableRef(to, table)}.${q(to, c.name)} IS '${esc(c.comment)}';`);
  }
  for (const ix of table.indexes) extra.push(indexSQL(table, ix, to));
  return [sql, ...extra].join("\n");
}

export interface DDLOptions {
  dropIfExists?: boolean;
  createSchemas?: boolean;
}

export function generateDDL(model: DataModel, to: Dialect, opts: DDLOptions = {}): string {
  const out: string[] = [
    `-- ${model.name}`,
    `-- Generated by DataModel Studio for ${to} on ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  if (opts.createSchemas && to !== "sqlite" && to !== "mysql") {
    const schemas = [...new Set(model.tables.map((t) => t.schema).filter(Boolean))] as string[];
    for (const s of schemas) {
      out.push(to === "sqlserver" ? `IF SCHEMA_ID('${s}') IS NULL EXEC('CREATE SCHEMA ${q(to, s)}');` : `CREATE SCHEMA IF NOT EXISTS ${q(to, s)};`);
    }
    if (schemas.length) out.push("");
  }
  if (opts.dropIfExists) {
    for (const t of [...model.tables].reverse()) {
      out.push(`DROP TABLE IF EXISTS ${tableRef(to, t)}${to === "postgres" || to === "snowflake" ? " CASCADE" : ""};`);
    }
    out.push("");
  }
  for (const t of model.tables) out.push(createTableSQL(model, t, to), "");
  if (to !== "sqlite" && model.relationships.length) {
    out.push("-- Foreign keys");
    for (const r of model.relationships) out.push(fkSQL(model, r, to));
    out.push("");
  }
  return out.join("\n");
}
