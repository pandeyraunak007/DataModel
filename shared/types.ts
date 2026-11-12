// The model JSON format. Everything the app saves, versions, diffs and
// forward-engineers is this structure.

export type Dialect = "postgres" | "mysql" | "sqlserver" | "sqlite" | "snowflake";

export const DIALECTS: { id: Dialect; label: string }[] = [
  { id: "postgres", label: "PostgreSQL" },
  { id: "mysql", label: "MySQL" },
  { id: "sqlserver", label: "SQL Server" },
  { id: "sqlite", label: "SQLite" },
  { id: "snowflake", label: "Snowflake" },
];

export interface Column {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  autoIncrement: boolean;
  default?: string;
  comment?: string;
}

export interface Index {
  id: string;
  name: string;
  /** column ids */
  columns: string[];
  unique: boolean;
}

export type TableRole = "fact" | "dimension" | "hub" | "link" | "satellite";

export interface Table {
  id: string;
  name: string;
  schema?: string;
  /** Grouping shown in the Model Explorer and used for per-area diagrams. */
  subjectArea?: string;
  /** Explicit classification; when unset it is inferred from the name (FACT_, DIM_, HUB_...). */
  role?: TableRole;
  comment?: string;
  columns: Column[];
  indexes: Index[];
  position: { x: number; y: number };
}

export type RefAction = "NO ACTION" | "CASCADE" | "SET NULL" | "RESTRICT";

/** A foreign key: fromTable is the child (holds the FK), toTable is the parent. */
export interface Relationship {
  id: string;
  name?: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  onDelete?: RefAction;
  onUpdate?: RefAction;
}

export type Pattern = "STAR_SCHEMA" | "SNOWFLAKE_SCHEMA" | "THIRD_NORMAL_FORM" | "DATA_VAULT_2" | "CANONICAL" | "CUSTOM";

/** The modeling context declared in guided setup. */
export interface ModelIntent {
  pattern: Pattern;
  domain: string;
  purpose: string;
  modelType: string;
  project: string;
  /** Pattern-specific answers (grain, history strategy, ...) keyed by field key. */
  details: Record<string, string>;
  naming: string;
  pkStrategy: string;
  guardrails: { patternRules: boolean; denorm: boolean; platformRules: boolean; approval: boolean };
}

export interface DataModel {
  formatVersion: 1;
  id: string;
  name: string;
  description?: string;
  dialect: Dialect;
  intent?: ModelIntent;
  tables: Table[];
  relationships: Relationship[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelSummary {
  id: string;
  name: string;
  dialect: Dialect;
  subtitle: string;
  tableCount: number;
  updatedAt: string;
  latestVersion: number;
}

export interface VersionInfo {
  version: number;
  message: string;
  createdAt: string;
  tableCount: number;
}

export interface ConnectionConfig {
  dialect: Exclude<Dialect, "snowflake">;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  schema?: string;
  ssl?: boolean;
  /** sqlite only */
  file?: string;
}

export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyModel(name: string, dialect: Dialect = "postgres"): DataModel {
  const now = new Date().toISOString();
  return {
    formatVersion: 1,
    id: uid("m_"),
    name,
    dialect,
    tables: [],
    relationships: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newColumn(partial: Partial<Column> = {}): Column {
  return {
    id: uid("c_"),
    name: "column",
    type: "varchar(255)",
    nullable: true,
    primaryKey: false,
    unique: false,
    autoIncrement: false,
    ...partial,
  };
}
