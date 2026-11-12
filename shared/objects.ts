// Database-specific objects other than tables: which kinds each platform has, and how to script them.
import { q } from "./ddl.ts";
import type { DataModel, DbObject, DbObjectKind, Dialect } from "./types.ts";

export interface KindInfo {
  kind: DbObjectKind;
  label: string;
  plural: string;
  /** Short badge text shown in the explorer. */
  chip: string;
  dialects: Dialect[];
  /** SQL keyword(s) used in CREATE / DROP. */
  keyword: string;
  /** Created before tables (tables may depend on them) rather than after. */
  early?: boolean;
}

const ALL: Dialect[] = ["postgres", "mysql", "sqlserver", "sqlite", "snowflake"];

export const KINDS: KindInfo[] = [
  { kind: "view", label: "View", plural: "Views", chip: "V", dialects: ALL, keyword: "VIEW" },
  { kind: "materialized_view", label: "Materialized view", plural: "Materialized Views", chip: "MV", dialects: ["postgres", "snowflake"], keyword: "MATERIALIZED VIEW" },
  { kind: "sequence", label: "Sequence", plural: "Sequences", chip: "SQ", dialects: ["postgres", "sqlserver", "snowflake"], keyword: "SEQUENCE", early: true },
  { kind: "function", label: "Function", plural: "Functions", chip: "fn", dialects: ["postgres", "mysql", "sqlserver", "snowflake"], keyword: "FUNCTION" },
  { kind: "procedure", label: "Stored procedure", plural: "Stored Procedures", chip: "SP", dialects: ["postgres", "mysql", "sqlserver", "snowflake"], keyword: "PROCEDURE" },
  { kind: "trigger", label: "Trigger", plural: "Triggers", chip: "TR", dialects: ["postgres", "mysql", "sqlserver", "sqlite"], keyword: "TRIGGER" },
  { kind: "type", label: "User-defined type", plural: "User-Defined Types", chip: "TY", dialects: ["postgres", "sqlserver"], keyword: "TYPE", early: true },
  { kind: "extension", label: "Extension", plural: "Extensions", chip: "EX", dialects: ["postgres"], keyword: "EXTENSION", early: true },
  { kind: "synonym", label: "Synonym", plural: "Synonyms", chip: "SY", dialects: ["sqlserver"], keyword: "SYNONYM" },
  { kind: "event", label: "Event", plural: "Events", chip: "EV", dialects: ["mysql"], keyword: "EVENT" },
  { kind: "stage", label: "Stage", plural: "Stages", chip: "ST", dialects: ["snowflake"], keyword: "STAGE", early: true },
  { kind: "file_format", label: "File format", plural: "File Formats", chip: "FF", dialects: ["snowflake"], keyword: "FILE FORMAT", early: true },
  { kind: "stream", label: "Stream", plural: "Streams", chip: "SM", dialects: ["snowflake"], keyword: "STREAM" },
  { kind: "task", label: "Task", plural: "Tasks", chip: "TK", dialects: ["snowflake"], keyword: "TASK" },
];

export const kindInfo = (k: DbObjectKind) => KINDS.find((x) => x.kind === k)!;
export const kindsFor = (d: Dialect) => KINDS.filter((k) => k.dialects.includes(d));
export const objectsOf = (m: Pick<DataModel, "objects">): DbObject[] => m.objects ?? [];

const objRef = (d: Dialect, o: Pick<DbObject, "name" | "schema">) => (o.schema && d !== "sqlite" ? q(d, o.schema) + "." : "") + q(d, o.name);

/** Starter definition for a new object of the given kind. */
export function objectTemplate(kind: DbObjectKind, d: Dialect, name: string, table = "table_name"): string {
  const n = q(d, name);
  switch (kind) {
    case "view": return `CREATE VIEW ${n} AS\nSELECT *\nFROM ${table};`;
    case "materialized_view": return `CREATE MATERIALIZED VIEW ${n} AS\nSELECT *\nFROM ${table};`;
    case "sequence": return d === "sqlserver" ? `CREATE SEQUENCE ${n} AS bigint START WITH 1 INCREMENT BY 1;` : `CREATE SEQUENCE ${n} START WITH 1 INCREMENT BY 1;`;
    case "function":
      if (d === "postgres") return `CREATE FUNCTION ${n}()\nRETURNS integer\nLANGUAGE sql\nAS $$\n  SELECT 1;\n$$;`;
      if (d === "mysql") return `CREATE FUNCTION ${n}()\nRETURNS INT DETERMINISTIC\nRETURN 1;`;
      if (d === "sqlserver") return `CREATE FUNCTION ${n}()\nRETURNS int\nAS\nBEGIN\n  RETURN 1;\nEND;`;
      return `CREATE FUNCTION ${n}()\nRETURNS NUMBER\nAS\n$$\n  1\n$$;`;
    case "procedure":
      if (d === "postgres") return `CREATE PROCEDURE ${n}()\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- body\nEND;\n$$;`;
      if (d === "mysql") return `CREATE PROCEDURE ${n}()\nBEGIN\n  -- body\nEND;`;
      if (d === "sqlserver") return `CREATE PROCEDURE ${n}\nAS\nBEGIN\n  SET NOCOUNT ON;\n  -- body\nEND;`;
      return `CREATE PROCEDURE ${n}()\nRETURNS STRING\nLANGUAGE SQL\nAS\n$$\nBEGIN\n  RETURN 'ok';\nEND;\n$$;`;
    case "trigger":
      if (d === "postgres") return `CREATE TRIGGER ${n}\nBEFORE UPDATE ON ${table}\nFOR EACH ROW\nEXECUTE FUNCTION function_name();`;
      if (d === "sqlserver") return `CREATE TRIGGER ${n}\nON ${table}\nAFTER UPDATE\nAS\nBEGIN\n  SET NOCOUNT ON;\n  -- body\nEND;`;
      return `CREATE TRIGGER ${n}\nAFTER UPDATE ON ${table}\nFOR EACH ROW\nBEGIN\n  -- body\nEND;`;
    case "type": return d === "postgres" ? `CREATE TYPE ${n} AS ENUM ('value_1', 'value_2');` : `CREATE TYPE ${n} FROM nvarchar(50) NOT NULL;`;
    case "extension": return `CREATE EXTENSION IF NOT EXISTS ${n};`;
    case "synonym": return `CREATE SYNONYM ${n} FOR ${table};`;
    case "event": return `CREATE EVENT ${n}\nON SCHEDULE EVERY 1 DAY\nDO\n  -- statement\n  SELECT 1;`;
    case "stage": return `CREATE STAGE ${n};`;
    case "file_format": return `CREATE FILE FORMAT ${n}\n  TYPE = CSV\n  SKIP_HEADER = 1;`;
    case "stream": return `CREATE STREAM ${n} ON TABLE ${table};`;
    case "task": return `CREATE TASK ${n}\n  SCHEDULE = '60 MINUTE'\nAS\n  SELECT 1;`;
  }
}

export function dropObjectSQL(o: DbObject, d: Dialect): string {
  const kw = kindInfo(o.kind).keyword;
  if (o.kind === "trigger" && d === "postgres" && o.table) return `DROP TRIGGER ${q(d, o.name)} ON ${q(d, o.table)};`;
  return `DROP ${kw} ${objRef(d, o)};`;
}

/** The object's CREATE statement, terminated for the target platform. */
export function objectSQL(o: DbObject, d: Dialect): string {
  const sql = o.definition.trim().replace(/;\s*$/, "");
  if (!sql) return `-- ${kindInfo(o.kind).label} ${o.name} has no definition`;
  // SQL Server modules must each be the only statement in their batch.
  return d === "sqlserver" ? `${sql};\nGO` : `${sql};`;
}

export const normalizeDefinition = (s: string) => s.replace(/\s+/g, " ").replace(/;\s*$/, "").trim().toLowerCase();
