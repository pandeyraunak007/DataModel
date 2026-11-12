// Deterministic, intent-aware model validation. Findings are review candidates, not verdicts.
import { normalizeType } from "./ddl.ts";
import { tableRole } from "./intent.ts";
import type { DataModel, Table } from "./types.ts";

export type Severity = "high" | "medium" | "low";
export interface Finding {
  id: string;
  rule: string;
  severity: Severity;
  category: "Structure" | "Methodology" | "Naming" | "Platform";
  tableId?: string;
  table?: string;
  title: string;
  detail: string;
}

const NUMERIC = /^(smallint|integer|bigint|numeric|number|decimal|real|double|float|money)/;
const CASE: Record<string, RegExp> = {
  snake_case: /^([a-z][a-z0-9]*(_[a-z0-9]+)*|[A-Z][A-Z0-9]*(_[A-Z0-9]+)*)$/,
  PascalCase: /^[A-Z][A-Za-z0-9]*$/,
  camelCase: /^[a-z][A-Za-z0-9]*$/,
};

export function validateModel(m: DataModel): Finding[] {
  const out: Finding[] = [];
  const intent = m.intent;
  const pat = intent?.guardrails.patternRules ? intent.pattern : undefined;
  const dimensional = pat === "STAR_SCHEMA" || pat === "SNOWFLAKE_SCHEMA";
  const add = (f: Omit<Finding, "id" | "table" | "tableId">, t?: Table) =>
    out.push({ ...f, id: `${f.rule}:${t?.id ?? "model"}:${out.length}`, tableId: t?.id, table: t?.name });
  const byId = new Map(m.tables.map((t) => [t.id, t]));
  const col = (t: Table | undefined, id: string) => t?.columns.find((c) => c.id === id);
  const fksOf = (t: Table) => m.relationships.filter((r) => r.fromTable === t.id);

  for (const t of m.tables) {
    const role = tableRole(t);
    const pk = t.columns.filter((c) => c.primaryKey);
    const fks = fksOf(t);
    const related = m.relationships.some((r) => r.fromTable === t.id || r.toTable === t.id);

    // ---- structure (always on)
    if (!t.columns.length) add({ rule: "no-columns", severity: "medium", category: "Structure", title: "Table has no columns", detail: `${t.name} is empty. Add its columns or remove it.` }, t);
    else if (!pk.length) add({ rule: "no-pk", severity: "high", category: "Structure", title: "No primary key", detail: `${t.name} has no primary key, so rows cannot be identified or referenced reliably.` }, t);
    if (!related && m.tables.length > 1) add({ rule: "isolated", severity: "low", category: "Structure", title: "Not related to any other table", detail: `${t.name} has no relationships. Confirm it belongs in this model or link it.` }, t);

    for (const r of fks) {
      const parent = byId.get(r.toTable);
      r.fromColumns.forEach((id, i) => {
        const a = col(t, id), b = col(parent, r.toColumns[i]);
        if (a && b && normalizeType(a.type) !== normalizeType(b.type))
          add({ rule: "fk-type", severity: "high", category: "Structure", title: "Foreign key type mismatch", detail: `${t.name}.${a.name} is ${a.type} but references ${parent!.name}.${b.name}, which is ${b.type}.` }, t);
      });
      // Index advice is platform-specific: Snowflake has no secondary indexes.
      const skipIndex = intent?.guardrails.platformRules !== false && m.dialect === "snowflake";
      const lead = r.fromColumns[0];
      const indexed = t.indexes.some((ix) => ix.columns[0] === lead) || pk[0]?.id === lead;
      if (!skipIndex && !indexed) {
        add({ rule: "fk-index", severity: "low", category: "Platform", title: "Foreign key is not indexed", detail: `${t.name}.${col(t, lead)?.name} is a foreign key with no supporting index, which slows joins and parent deletes on ${m.dialect}.` }, t);
      }
    }

    // ---- naming
    const re = intent && CASE[intent.naming];
    if (re) {
      const bad = [t.name, ...t.columns.map((c) => c.name)].filter((n) => !re.test(n));
      if (bad.length)
        add({ rule: "naming", severity: "low", category: "Naming", title: `Names do not follow ${intent!.naming}`, detail: `${bad.slice(0, 6).join(", ")}${bad.length > 6 ? ` and ${bad.length - 6} more` : ""}.` }, t);
    }

    // ---- repeating groups (address1, address2, ...): a defect in 3NF, tolerated in dimensional models when allowed
    const series = new Map<string, number>();
    for (const c of t.columns) {
      const mm = c.name.match(/^(.*?)_?\d+$/);
      if (mm && mm[1]) series.set(mm[1].toLowerCase(), (series.get(mm[1].toLowerCase()) ?? 0) + 1);
    }
    const groups = [...series].filter(([, n]) => n >= 2).map(([k]) => k);
    const denormOk = intent?.guardrails.denorm && dimensional && role === "dimension";
    if (groups.length && !denormOk && (pat === "THIRD_NORMAL_FORM" || !intent?.guardrails.denorm || !pat))
      add({ rule: "repeating-group", severity: "medium", category: "Methodology", title: "Repeating group", detail: `${t.name} repeats ${groups.join(", ")} across numbered columns. Consider a child table.` }, t);

    // ---- dimensional
    if (dimensional) {
      if (!role) add({ rule: "unclassified", severity: "low", category: "Methodology", title: "Not classified as fact or dimension", detail: `Set a role for ${t.name}, or name it with a FACT_ / DIM_ prefix, so dimensional rules can be applied.` }, t);
      if (role === "fact") {
        if (!fks.length) add({ rule: "fact-no-dims", severity: "high", category: "Methodology", title: "Fact has no dimension keys", detail: `${t.name} does not reference any dimension. A fact row is described by the dimensions it joins to.` }, t);
        const fkCols = new Set(fks.flatMap((r) => r.fromColumns));
        if (!t.columns.some((c) => !c.primaryKey && !fkCols.has(c.id) && NUMERIC.test(normalizeType(c.type))))
          add({ rule: "fact-no-measures", severity: "medium", category: "Methodology", title: "Fact has no measures", detail: `${t.name} has no numeric non-key columns. Confirm it is an intentional factless fact.` }, t);
        if (!intent?.details.grain) add({ rule: "grain", severity: "medium", category: "Methodology", title: "Fact grain is not declared", detail: `Declare the grain in the modeling context so ${t.name}'s measures and keys can be checked against it.` }, t);
      }
      if (role === "dimension") {
        if (intent?.pkStrategy === "Surrogate key" && pk.length > 1)
          add({ rule: "dim-surrogate", severity: "medium", category: "Methodology", title: "Dimension key is not a single surrogate", detail: `${t.name} has a ${pk.length}-column primary key, but the model's key strategy is a surrogate key.` }, t);
        const toDim = fks.filter((r) => r.toTable !== t.id && tableRole(byId.get(r.toTable)!) === "dimension");
        if (pat === "STAR_SCHEMA" && toDim.length)
          add({ rule: "snowflaked", severity: "medium", category: "Methodology", title: "Dimension is snowflaked", detail: `${t.name} references ${toDim.map((r) => byId.get(r.toTable)!.name).join(", ")}. In a star schema, fold small hierarchies into the dimension unless reuse justifies the extra join.` }, t);
      }
    }

    // ---- data vault
    if (pat === "DATA_VAULT_2") {
      const has = (re: RegExp) => t.columns.some((c) => re.test(c.name));
      if (!role) add({ rule: "unclassified", severity: "low", category: "Methodology", title: "Not classified as hub, link or satellite", detail: `Set a role for ${t.name}, or name it with a HUB_ / LNK_ / SAT_ prefix.` }, t);
      if (role === "hub" && !t.columns.some((c) => !c.primaryKey && c.unique))
        add({ rule: "hub-bk", severity: "high", category: "Methodology", title: "Hub has no unique business key", detail: `${t.name} needs a business key column with a unique constraint alongside its hash key.` }, t);
      if (role === "link" && fks.length < 2)
        add({ rule: "link-fks", severity: "high", category: "Methodology", title: "Link references fewer than two hubs", detail: `${t.name} has ${fks.length} foreign key(s). A link records a relationship between at least two hubs.` }, t);
      if (role === "satellite" && fks.length !== 1)
        add({ rule: "sat-parent", severity: "high", category: "Methodology", title: "Satellite needs exactly one parent", detail: `${t.name} has ${fks.length} foreign key(s). A satellite hangs off one hub or link.` }, t);
      if (role && !has(/load_?(date|dts|ts|time)/i))
        add({ rule: "dv-load-date", severity: "medium", category: "Methodology", title: "Missing load timestamp", detail: `${t.name} has no load date column.` }, t);
      if (role && !has(/record_?source|rec_?src/i))
        add({ rule: "dv-record-source", severity: "low", category: "Methodology", title: "Missing record source", detail: `${t.name} has no record source column.` }, t);
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
