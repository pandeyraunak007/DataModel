// Modeling intent: the context a modeler declares up front. It drives validation rules,
// the copilot's behaviour, and how tables are classified on the canvas.
import { DIALECTS, type Column, type DataModel, type ModelIntent, type Pattern, type Table, type TableRole } from "./types.ts";

export interface PatternField {
  key: string;
  label: string;
  options?: string[];
  default: string;
}
export interface PatternInfo {
  id: Pattern;
  name: string;
  symbol: string;
  blurb: string;
  explain: string;
  lens: string;
  fields: PatternField[];
  suggestions: string[];
}

export const PATTERNS: PatternInfo[] = [
  {
    id: "STAR_SCHEMA", name: "Star Schema", symbol: "✣", blurb: "Fact and dimension tables for analytics",
    explain: "Forma prioritizes fact grain, conformed dimensions, surrogate keys, dimensional history and measure behavior over transactional normalization.",
    lens: "Check fact grain, identify conformed dimensions, and evaluate slowly changing dimension handling.",
    fields: [
      { key: "grain", label: "Fact table grain", default: "" },
      { key: "history", label: "Dimension history strategy", options: ["Type 2 for selected dimensions", "Type 1 overwrite", "Type 0 retain original", "Mixed SCD by dimension"], default: "Type 2 for selected dimensions" },
      { key: "focus", label: "Fact table focus", default: "" },
      { key: "structures", label: "Conformed dimensions", default: "" },
    ],
    suggestions: ["Review fact grain", "Check SCD strategy", "Find design issues"],
  },
  {
    id: "SNOWFLAKE_SCHEMA", name: "Snowflake Schema", symbol: "❄", blurb: "Normalized dimensional structures",
    explain: "Forma emphasizes dimensional consistency while allowing dimensions to be normalized into sub-dimensions where this supports governance and reuse.",
    lens: "Review dimension hierarchies, surrogate key propagation and join paths. Avoid normalization that only adds query complexity.",
    fields: [
      { key: "grain", label: "Dimension hierarchy approach", options: ["Normalize shared hierarchies", "Keep small dimensions denormalized", "Mixed by subject area"], default: "Normalize shared hierarchies" },
      { key: "history", label: "Historical tracking", options: ["Type 2 for selected dimensions", "Type 1 overwrite", "Mixed SCD by dimension"], default: "Type 2 for selected dimensions" },
      { key: "focus", label: "Shared hierarchies", default: "" },
      { key: "structures", label: "Conformed dimensions", default: "" },
    ],
    suggestions: ["Review dimension hierarchies", "Check join paths", "Find design issues"],
  },
  {
    id: "THIRD_NORMAL_FORM", name: "3NF / Relational", symbol: "▦", blurb: "Transactional normalized models",
    explain: "Forma prioritizes functional dependencies, normalization, referential integrity and transactional consistency.",
    lens: "Inspect candidate keys, functional dependencies, repeating groups and update anomalies. Dimensional denormalization is not recommended by default.",
    fields: [
      { key: "grain", label: "Normalization target", options: ["Third Normal Form (3NF)", "BCNF", "Second Normal Form (2NF)"], default: "Third Normal Form (3NF)" },
      { key: "history", label: "Referential integrity", options: ["Enforced in database", "Validated in pipeline", "Logical only"], default: "Enforced in database" },
      { key: "focus", label: "Key strategy notes", default: "" },
      { key: "structures", label: "Business dependencies", default: "" },
    ],
    suggestions: ["Check normalization", "Review keys and constraints", "Find design issues"],
  },
  {
    id: "DATA_VAULT_2", name: "Data Vault 2.0", symbol: "⬡", blurb: "Hubs, Links and Satellites",
    explain: "Forma evaluates business keys, Hubs, Links, Satellites, historization, hash keys and load patterns rather than star-schema rules.",
    lens: "Identify Hubs from stable business keys, Links from business relationships, and Satellites for descriptive history and source context.",
    fields: [
      { key: "grain", label: "Hash key strategy", options: ["SHA-256", "MD5 (legacy compatibility)", "Organization standard"], default: "SHA-256" },
      { key: "history", label: "Satellite historization", options: ["Insert-only with load timestamps", "Effectivity satellites", "Mixed by satellite type"], default: "Insert-only with load timestamps" },
      { key: "focus", label: "Business key approach", default: "" },
      { key: "structures", label: "Source tracking", default: "" },
    ],
    suggestions: ["Review hubs and business keys", "Check satellite design", "Find design issues"],
  },
  {
    id: "CANONICAL", name: "Canonical Model", symbol: "◎", blurb: "Reusable enterprise structures",
    explain: "Forma focuses on consistent enterprise concepts, canonical definitions, shared identifiers, bounded contexts and mappings to source and target systems.",
    lens: "Check business concept reuse, definition consistency, identifier governance and ownership across domains.",
    fields: [
      { key: "grain", label: "Canonical scope", options: ["Enterprise-wide", "Domain-level", "Integration-specific"], default: "Enterprise-wide" },
      { key: "history", label: "Change governance", options: ["Versioned contracts", "Backward-compatible evolution", "Central approval"], default: "Versioned contracts" },
      { key: "focus", label: "Core business concepts", default: "" },
      { key: "structures", label: "Mapping strategy", default: "" },
    ],
    suggestions: ["Review concept definitions", "Check identifier consistency", "Find design issues"],
  },
  {
    id: "CUSTOM", name: "Custom", symbol: "✎", blurb: "Organization-defined methodology",
    explain: "Forma uses the rules and design decisions you state explicitly, and avoids assumptions where no standard methodology applies.",
    lens: "Define your own structural rules, required metadata and approved design patterns.",
    fields: [
      { key: "grain", label: "Methodology name", default: "" },
      { key: "history", label: "Validation approach", options: ["Organization-defined", "Strict", "Advisory"], default: "Advisory" },
      { key: "focus", label: "Required structures", default: "" },
      { key: "structures", label: "Design principles", default: "" },
    ],
    suggestions: ["Review this model", "Suggest indexes", "Find design issues"],
  },
];

export const pattern = (id: Pattern) => PATTERNS.find((p) => p.id === id)!;

export const DOMAINS = ["Finance", "Banking", "Retail", "Healthcare", "Manufacturing", "SaaS / Technology", "Cross-industry"];
export const PURPOSES = ["BI & analytical reporting", "Enterprise data warehouse", "Operational application", "Data integration", "AI / agent consumption"];
export const MODEL_TYPES = ["Logical + Physical", "Logical only", "Physical only"];
export const NAMING = ["snake_case", "PascalCase", "camelCase", "Organization standard"];
export const PK_STRATEGIES = ["Surrogate key", "Natural key", "Composite key", "Pattern-defined"];

export function defaultIntent(p: Pattern = "STAR_SCHEMA"): ModelIntent {
  return {
    pattern: p,
    domain: "Finance",
    purpose: "BI & analytical reporting",
    modelType: "Logical + Physical",
    project: "",
    details: Object.fromEntries(pattern(p).fields.map((f) => [f.key, f.default])),
    naming: "snake_case",
    pkStrategy: "Surrogate key",
    guardrails: { patternRules: true, denorm: true, platformRules: true, approval: true },
  };
}

export const platformLabel = (m: Pick<DataModel, "dialect">) => DIALECTS.find((d) => d.id === m.dialect)?.label ?? m.dialect;

export function modelSubtitle(m: Pick<DataModel, "dialect" | "intent">): string {
  return m.intent ? `${m.intent.domain} · ${pattern(m.intent.pattern).name} · ${platformLabel(m)}` : `${platformLabel(m)} · no modeling context`;
}

/** A table's role: explicit if set, otherwise inferred from common naming prefixes. */
export function tableRole(t: Pick<Table, "name" | "role">): TableRole | undefined {
  if (t.role) return t.role;
  const n = t.name.toLowerCase();
  if (/^(fact|fct)_|_fact$/.test(n)) return "fact";
  if (/^dim_|_dim$/.test(n)) return "dimension";
  if (/^hub_/.test(n)) return "hub";
  if (/^(lnk|link)_/.test(n)) return "link";
  if (/^sat_/.test(n)) return "satellite";
  return undefined;
}

const PII = /(^|_)(e?mail|first_?name|last_?name|full_?name|surname|phone|mobile|fax|street|address|addr|city|zip|postal|postcode|dob|birth|ssn|sin|nin|passport|national_?id|tax_?id|ip_?addr(ess)?|latitude|longitude|gender|license)/i;
const SENSITIVE = /(password|passwd|pwd|secret|token|api_?key|private_?key|(^|_)salt($|_)|salary|income|credit_?card|card_?(no|num)|cvv|iban|account_?(no|num)|pin($|_))/i;

/** A column's data classification: explicit if set, otherwise inferred from its name. */
export function columnClass(c: Pick<Column, "name" | "classification">): "pii" | "sensitive" | undefined {
  if (c.classification) return c.classification === "none" ? undefined : c.classification;
  if (SENSITIVE.test(c.name)) return "sensitive";
  if (PII.test(c.name)) return "pii";
  return undefined;
}

export const ROLE_LABEL: Record<TableRole, string> = { fact: "FACT", dimension: "DIM", hub: "HUB", link: "LINK", satellite: "SAT" };

/** Plain-text rendering of the intent profile, given to the copilot with every request. */
export function describeIntent(m: DataModel): string {
  const i = m.intent;
  if (!i) return "No modeling context has been declared for this model. Do not assume a methodology; ask if it matters.";
  const p = pattern(i.pattern);
  const g = i.guardrails;
  const lines = [
    `Methodology: ${p.name}`,
    `Business domain: ${i.domain}`,
    `Primary workload: ${i.purpose}`,
    `Target platform: ${platformLabel(m)}`,
    `Model type: ${i.modelType}`,
    ...p.fields.filter((f) => i.details[f.key]).map((f) => `${f.label}: ${i.details[f.key]}`),
    `Naming convention: ${i.naming}`,
    `Primary key strategy: ${i.pkStrategy}`,
    "Guardrails:",
    `- ${g.patternRules ? "Judge the design by the rules of the selected methodology before generic heuristics." : "Methodology-specific validation is turned off; use general design judgment."}`,
    `- ${g.denorm ? "Redundancy that the methodology calls for is intentional. Do not report it as a defect." : "Report redundancy even where the methodology would normally allow it."}`,
    `- ${g.platformRules ? `Take ${platformLabel(m)} specifics into account (types, constraints, physical design).` : "Keep advice platform-neutral."}`,
    `- ${g.approval ? "Edits you make with apply_operations are proposals. The modeler reviews and approves them before they reach the model, so describe them as proposed changes." : "Edits you make with apply_operations are applied to the model immediately."}`,
  ];
  return lines.join("\n");
}
