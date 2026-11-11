// Compare two models (matched by table / column name) and build a migration script.
import { columnDef, createTableSQL, mapType, normalizeType, q, tableRef } from "./ddl.ts";
import type { Column, DataModel, Dialect, Table } from "./types.ts";

export interface RelN {
  name?: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  onDelete?: string;
}
export interface IndexN {
  name: string;
  columns: string[];
  unique: boolean;
}
export interface ColumnChange {
  name: string;
  from: Column;
  to: Column;
  changes: string[];
}
export interface TableChange {
  name: string;
  from: Table;
  to: Table;
  columnsAdded: Column[];
  columnsRemoved: Column[];
  columnsChanged: ColumnChange[];
  pkChanged: boolean;
  indexesAdded: IndexN[];
  indexesRemoved: IndexN[];
  commentChanged: boolean;
}
export interface ModelDiff {
  tablesAdded: Table[];
  tablesRemoved: Table[];
  tablesChanged: TableChange[];
  relationshipsAdded: RelN[];
  relationshipsRemoved: RelN[];
  changeCount: number;
}

const key = (s: string) => s.toLowerCase();

function relsN(m: DataModel): RelN[] {
  return m.relationships.map((r) => {
    const child = m.tables.find((t) => t.id === r.fromTable);
    const parent = m.tables.find((t) => t.id === r.toTable);
    const n = (t: Table | undefined, ids: string[]) => ids.map((id) => t?.columns.find((c) => c.id === id)?.name ?? "?");
    return {
      name: r.name,
      fromTable: child?.name ?? "?",
      fromColumns: n(child, r.fromColumns),
      toTable: parent?.name ?? "?",
      toColumns: n(parent, r.toColumns),
      onDelete: r.onDelete,
    };
  });
}
const relKey = (r: RelN) => key(`${r.fromTable}(${r.fromColumns.join(",")})->${r.toTable}(${r.toColumns.join(",")})`);

function indexesN(t: Table): IndexN[] {
  return t.indexes.map((ix) => ({
    name: ix.name,
    unique: ix.unique,
    columns: ix.columns.map((id) => t.columns.find((c) => c.id === id)?.name ?? "?"),
  }));
}
const ixKey = (ix: IndexN) => key(`${ix.unique ? "u" : "i"}:${ix.columns.join(",")}`);

/** Diff describing how to turn `from` into `to`. Types are compared in `to`'s dialect. */
export function diffModels(from: DataModel, to: DataModel): ModelDiff {
  const fromMap = new Map(from.tables.map((t) => [key(t.name), t]));
  const toMap = new Map(to.tables.map((t) => [key(t.name), t]));
  const d: ModelDiff = {
    tablesAdded: to.tables.filter((t) => !fromMap.has(key(t.name))),
    tablesRemoved: from.tables.filter((t) => !toMap.has(key(t.name))),
    tablesChanged: [],
    relationshipsAdded: [],
    relationshipsRemoved: [],
    changeCount: 0,
  };

  for (const tt of to.tables) {
    const ft = fromMap.get(key(tt.name));
    if (!ft) continue;
    const fc = new Map(ft.columns.map((c) => [key(c.name), c]));
    const tc = new Map(tt.columns.map((c) => [key(c.name), c]));
    const columnsChanged: ColumnChange[] = [];
    let pkChanged = false;
    for (const c of tt.columns) {
      const o = fc.get(key(c.name));
      if (!o) continue;
      const changes: string[] = [];
      const ot = normalizeType(mapType(o.type, from.dialect, to.dialect));
      const nt = normalizeType(c.type);
      if (ot !== nt) changes.push(`type: ${o.type} → ${c.type}`);
      if (o.nullable !== c.nullable && !c.primaryKey && !o.primaryKey) changes.push(c.nullable ? "now nullable" : "now NOT NULL");
      if ((o.default ?? "") !== (c.default ?? "")) changes.push(`default: ${o.default || "none"} → ${c.default || "none"}`);
      if (o.unique !== c.unique) changes.push(c.unique ? "now unique" : "no longer unique");
      if (o.primaryKey !== c.primaryKey) {
        pkChanged = true;
        changes.push(c.primaryKey ? "added to primary key" : "removed from primary key");
      }
      if (changes.length) columnsChanged.push({ name: c.name, from: o, to: c, changes });
    }
    const columnsAdded = tt.columns.filter((c) => !fc.has(key(c.name)));
    const columnsRemoved = ft.columns.filter((c) => !tc.has(key(c.name)));
    if (columnsAdded.some((c) => c.primaryKey) || columnsRemoved.some((c) => c.primaryKey)) pkChanged = true;
    const fi = indexesN(ft), ti = indexesN(tt);
    const fik = new Set(fi.map(ixKey)), tik = new Set(ti.map(ixKey));
    const change: TableChange = {
      name: tt.name,
      from: ft,
      to: tt,
      columnsAdded,
      columnsRemoved,
      columnsChanged,
      pkChanged,
      indexesAdded: ti.filter((i) => !fik.has(ixKey(i))),
      indexesRemoved: fi.filter((i) => !tik.has(ixKey(i))),
      commentChanged: (ft.comment ?? "") !== (tt.comment ?? ""),
    };
    if (
      columnsAdded.length || columnsRemoved.length || columnsChanged.length ||
      change.indexesAdded.length || change.indexesRemoved.length || change.commentChanged
    )
      d.tablesChanged.push(change);
  }

  const fr = relsN(from), tr = relsN(to);
  const frk = new Set(fr.map(relKey)), trk = new Set(tr.map(relKey));
  d.relationshipsAdded = tr.filter((r) => !frk.has(relKey(r)));
  d.relationshipsRemoved = fr.filter((r) => !trk.has(relKey(r)));

  d.changeCount =
    d.tablesAdded.length + d.tablesRemoved.length + d.relationshipsAdded.length + d.relationshipsRemoved.length +
    d.tablesChanged.reduce(
      (n, t) =>
        n + t.columnsAdded.length + t.columnsRemoved.length + t.columnsChanged.length + t.indexesAdded.length +
        t.indexesRemoved.length + (t.commentChanged ? 1 : 0),
      0,
    );
  return d;
}

function fkName(r: RelN) {
  return r.name || `fk_${r.fromTable}_${r.fromColumns.join("_")}`;
}

/** ALTER script that migrates a database shaped like `from` to match `to`. */
export function generateMigration(from: DataModel, to: DataModel, dialect: Dialect, diff = diffModels(from, to)): string {
  const out: string[] = [`-- Migration: ${from.name} → ${to.name} (${dialect})`, `-- ${diff.changeCount} change(s)`, ""];
  if (!diff.changeCount) return out.join("\n") + "-- Models are identical. Nothing to do.\n";
  const d = dialect;
  const tref = (name: string, m: DataModel) => {
    const t = m.tables.find((x) => key(x.name) === key(name));
    return t ? tableRef(d, t) : q(d, name);
  };
  const cols = (c: string[]) => c.map((n) => q(d, n)).join(", ");
  const dropFk = (r: RelN) =>
    d === "sqlite"
      ? `-- SQLite cannot drop foreign key ${fkName(r)} on ${r.fromTable}; rebuild the table.`
      : `ALTER TABLE ${tref(r.fromTable, from)} DROP ${d === "mysql" ? "FOREIGN KEY" : "CONSTRAINT"} ${q(d, fkName(r))};`;

  if (diff.relationshipsRemoved.length) {
    out.push("-- Drop removed foreign keys");
    diff.relationshipsRemoved.forEach((r) => out.push(dropFk(r)));
    out.push("");
  }
  if (diff.tablesAdded.length) {
    out.push("-- New tables");
    for (const t of diff.tablesAdded) out.push(createTableSQL({ ...to, relationships: d === "sqlite" ? to.relationships : [] }, t, d), "");
  }
  for (const tc of diff.tablesChanged) {
    out.push(`-- Table ${tc.name}`);
    const T = tableRef(d, tc.to);
    for (const ix of tc.indexesRemoved)
      out.push(d === "mysql" || d === "sqlserver" ? `DROP INDEX ${q(d, ix.name)} ON ${T};` : `DROP INDEX ${q(d, ix.name)};`);
    for (const c of tc.columnsAdded) {
      out.push(`ALTER TABLE ${T} ADD ${d === "sqlserver" ? "" : "COLUMN "}${columnDef({ ...c, primaryKey: false }, tc.to, to.dialect, d)};`);
      if (!c.nullable && !c.default) out.push(`--   ⚠ ${c.name} is NOT NULL with no default; this fails if the table has rows.`);
    }
    for (const cc of tc.columnsChanged) {
      const c = cc.to;
      const C = q(d, c.name);
      const type = mapType(c.type, to.dialect, d);
      const typeChanged = cc.changes.some((x) => x.startsWith("type"));
      const nullChanged = cc.changes.some((x) => x.startsWith("now n") || x.startsWith("now N"));
      const defChanged = cc.changes.some((x) => x.startsWith("default"));
      out.push(`--   ${c.name}: ${cc.changes.join("; ")}`);
      if (d === "sqlite") {
        out.push(`--   SQLite cannot alter column ${c.name}; rebuild the table.`);
      } else if (d === "mysql") {
        if (typeChanged || nullChanged || defChanged) out.push(`ALTER TABLE ${T} MODIFY COLUMN ${columnDef({ ...c, unique: false }, tc.to, to.dialect, d)};`);
      } else if (d === "sqlserver") {
        if (typeChanged || nullChanged) out.push(`ALTER TABLE ${T} ALTER COLUMN ${C} ${type} ${c.nullable ? "NULL" : "NOT NULL"};`);
        if (defChanged && c.default) out.push(`ALTER TABLE ${T} ADD DEFAULT ${c.default} FOR ${C};`);
      } else {
        if (typeChanged) out.push(`ALTER TABLE ${T} ALTER COLUMN ${C} ${d === "snowflake" ? "SET DATA TYPE" : "TYPE"} ${type};`);
        if (nullChanged) out.push(`ALTER TABLE ${T} ALTER COLUMN ${C} ${c.nullable ? "DROP" : "SET"} NOT NULL;`);
        if (defChanged) out.push(`ALTER TABLE ${T} ALTER COLUMN ${C} ${c.default ? "SET DEFAULT " + c.default : "DROP DEFAULT"};`);
      }
      if (cc.from.unique !== c.unique && d !== "sqlite") {
        const un = q(d, `uq_${tc.name}_${c.name}`);
        out.push(c.unique ? `ALTER TABLE ${T} ADD CONSTRAINT ${un} UNIQUE (${C});` : `-- Drop the unique constraint on ${tc.name}.${c.name} (constraint name depends on the database).`);
      }
    }
    if (tc.pkChanged) {
      const pk = tc.to.columns.filter((c) => c.primaryKey).map((c) => c.name);
      out.push(`-- Primary key changed; drop the existing PK constraint first if one exists.`);
      if (pk.length && d !== "sqlite") out.push(`ALTER TABLE ${T} ADD CONSTRAINT ${q(d, "pk_" + tc.name)} PRIMARY KEY (${cols(pk)});`);
    }
    for (const c of tc.columnsRemoved) out.push(`ALTER TABLE ${T} DROP COLUMN ${q(d, c.name)};`);
    for (const ix of tc.indexesAdded) out.push(`CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${q(d, ix.name)} ON ${T} (${cols(ix.columns)});`);
    if (tc.commentChanged && (d === "postgres" || d === "snowflake"))
      out.push(`COMMENT ON TABLE ${T} IS '${(tc.to.comment ?? "").replace(/'/g, "''")}';`);
    out.push("");
  }
  if (diff.relationshipsAdded.length && d !== "sqlite") {
    out.push("-- New foreign keys");
    for (const r of diff.relationshipsAdded) {
      let s = `ALTER TABLE ${tref(r.fromTable, to)} ADD CONSTRAINT ${q(d, fkName(r))} FOREIGN KEY (${cols(r.fromColumns)}) REFERENCES ${tref(r.toTable, to)} (${cols(r.toColumns)})`;
      if (r.onDelete && r.onDelete !== "NO ACTION") s += ` ON DELETE ${r.onDelete}`;
      out.push(s + ";");
    }
    out.push("");
  } else if (diff.relationshipsAdded.some((r) => !diff.tablesAdded.some((t) => key(t.name) === key(r.fromTable)))) {
    out.push("-- SQLite cannot add foreign keys to existing tables; rebuild the affected tables.", "");
  }
  if (diff.tablesRemoved.length) {
    out.push("-- Removed tables");
    for (const t of diff.tablesRemoved) out.push(`DROP TABLE ${tableRef(d, t)};`);
    out.push("");
  }
  return out.join("\n");
}

/** Short plain-text description of a diff (used as AI context). */
export function describeDiff(diff: ModelDiff): string {
  const l: string[] = [];
  diff.tablesAdded.forEach((t) => l.push(`+ table ${t.name} (${t.columns.length} columns)`));
  diff.tablesRemoved.forEach((t) => l.push(`- table ${t.name}`));
  for (const t of diff.tablesChanged) {
    t.columnsAdded.forEach((c) => l.push(`+ column ${t.name}.${c.name} ${c.type}`));
    t.columnsRemoved.forEach((c) => l.push(`- column ${t.name}.${c.name}`));
    t.columnsChanged.forEach((c) => l.push(`~ column ${t.name}.${c.name}: ${c.changes.join("; ")}`));
    t.indexesAdded.forEach((i) => l.push(`+ index ${t.name}(${i.columns.join(",")})`));
    t.indexesRemoved.forEach((i) => l.push(`- index ${t.name}(${i.columns.join(",")})`));
  }
  const r = (x: RelN) => `${x.fromTable}(${x.fromColumns.join(",")}) → ${x.toTable}(${x.toColumns.join(",")})`;
  diff.relationshipsAdded.forEach((x) => l.push(`+ foreign key ${r(x)}`));
  diff.relationshipsRemoved.forEach((x) => l.push(`- foreign key ${r(x)}`));
  return l.join("\n") || "No differences.";
}
