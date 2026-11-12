// Name-based edit operations. This is the vocabulary the AI assistant uses to change a model.
import { z } from "zod";
import { newColumn, uid, type DataModel, type RefAction, type Table } from "./types.ts";

const ColumnSpec = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  unique: z.boolean().optional(),
  autoIncrement: z.boolean().optional(),
  default: z.string().optional(),
  comment: z.string().optional(),
  classification: z.enum(["pii", "sensitive", "none"]).optional(),
});
const RoleZ = z.enum(["fact", "dimension", "hub", "link", "satellite"]);
const RefActionZ = z.enum(["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"]);

export const Operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_table"), table: z.string().min(1), schema: z.string().optional(), comment: z.string().optional(), subjectArea: z.string().optional(), role: RoleZ.optional(), columns: z.array(ColumnSpec) }),
  z.object({ op: z.literal("update_table"), table: z.string(), subjectArea: z.string().optional(), role: RoleZ.optional(), comment: z.string().optional(), schema: z.string().optional() }),
  z.object({ op: z.literal("drop_table"), table: z.string() }),
  z.object({ op: z.literal("rename_table"), table: z.string(), newName: z.string().min(1) }),
  z.object({ op: z.literal("set_table_comment"), table: z.string(), comment: z.string() }),
  z.object({ op: z.literal("add_column"), table: z.string(), column: ColumnSpec }),
  z.object({ op: z.literal("alter_column"), table: z.string(), column: z.string(), changes: ColumnSpec.partial() }),
  z.object({ op: z.literal("drop_column"), table: z.string(), column: z.string() }),
  z.object({
    op: z.literal("add_relationship"),
    fromTable: z.string(), fromColumns: z.array(z.string()).min(1),
    toTable: z.string(), toColumns: z.array(z.string()).min(1),
    name: z.string().optional(), onDelete: RefActionZ.optional(), onUpdate: RefActionZ.optional(),
  }),
  z.object({ op: z.literal("drop_relationship"), fromTable: z.string(), fromColumns: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("add_index"), table: z.string(), columns: z.array(z.string()).min(1), name: z.string().optional(), unique: z.boolean().optional() }),
  z.object({ op: z.literal("drop_index"), table: z.string(), name: z.string() }),
  z.object({ op: z.literal("set_model_info"), name: z.string().optional(), description: z.string().optional() }),
]);
export type Operation = z.infer<typeof Operation>;
export const OperationsInput = z.object({ operations: z.array(Operation).min(1) });

const columnSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string", description: "SQL type in the model's dialect, e.g. bigint, varchar(120), timestamptz" },
    nullable: { type: "boolean" },
    primaryKey: { type: "boolean" },
    unique: { type: "boolean" },
    autoIncrement: { type: "boolean" },
    default: { type: "string", description: "SQL default expression" },
    comment: { type: "string" },
    classification: { type: "string", enum: ["pii", "sensitive", "none"], description: "Data classification; omit to let the app infer it from the column name" },
  },
};

/** JSON Schema for the apply_operations tool input. */
export const operationsJsonSchema = {
  type: "object" as const,
  properties: {
    operations: {
      type: "array",
      description: "Operations applied in order. Tables and columns are referenced by name.",
      items: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: [
              "add_table", "update_table", "drop_table", "rename_table", "set_table_comment", "add_column", "alter_column", "drop_column",
              "add_relationship", "drop_relationship", "add_index", "drop_index", "set_model_info",
            ],
          },
          table: { type: "string", description: "Table name (all table/column/index ops)" },
          schema: { type: "string", description: "add_table: optional schema name" },
          comment: { type: "string", description: "add_table, update_table, set_table_comment" },
          subjectArea: { type: "string", description: "add_table, update_table: subject area the table belongs to, e.g. Sales, Customer, Shared Dimensions" },
          role: { type: "string", enum: ["fact", "dimension", "hub", "link", "satellite"], description: "add_table, update_table: classification under the model's methodology, when one applies" },
          columns: {
            description: "add_table: array of column objects {name,type,nullable,primaryKey,unique,autoIncrement,default,comment}. add_index: array of column names.",
            type: "array",
            items: { anyOf: [{ type: "string" }, { ...columnSchema, required: ["name", "type"] }] },
          },
          newName: { type: "string", description: "rename_table" },
          column: {
            description: "add_column: a column object. alter_column / drop_column: the column name.",
            anyOf: [{ type: "string" }, { ...columnSchema, required: ["name", "type"] }],
          },
          changes: { ...columnSchema, description: "alter_column: only the fields to change" },
          fromTable: { type: "string", description: "add_relationship / drop_relationship: child table holding the foreign key" },
          fromColumns: { type: "array", items: { type: "string" } },
          toTable: { type: "string", description: "add_relationship: referenced parent table" },
          toColumns: { type: "array", items: { type: "string" } },
          onDelete: { type: "string", enum: ["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"] },
          onUpdate: { type: "string", enum: ["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"] },
          name: { type: "string", description: "add_relationship: constraint name. add_index / drop_index: index name. set_model_info: model name." },
          unique: { type: "boolean", description: "add_index" },
          description: { type: "string", description: "set_model_info" },
        },
        required: ["op"],
      },
    },
  },
  required: ["operations"],
};

/**
 * The same tool input for providers whose function-calling schema has no `anyOf`
 * (Gemini, some Groq models): each property has exactly one type. `columnName` and
 * `columnNames` stand in for the string forms of `column` / `columns`.
 */
export const compatOperationsJsonSchema = (() => {
  const base = structuredClone(operationsJsonSchema) as any;
  const props = base.properties.operations.items.properties;
  props.columns = { type: "array", description: "add_table only: the table's columns", items: { ...columnSchema, required: ["name", "type"] } };
  props.column = { ...columnSchema, description: "add_column only: the new column" };
  props.columnName = { type: "string", description: "alter_column / drop_column: name of the existing column" };
  props.columnNames = { type: "array", items: { type: "string" }, description: "add_index: names of the indexed columns, in order" };
  return base as typeof operationsJsonSchema;
})();

/** Map the compat field names back onto the canonical operation shape. */
export function normalizeCompatInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || !Array.isArray((input as any).operations)) return input;
  return {
    operations: (input as any).operations.map((raw: any) => {
      if (!raw || typeof raw !== "object") return raw;
      const { columnName, columnNames, ...op } = raw;
      // Models often send empty placeholders for fields that do not apply.
      for (const k of Object.keys(op)) if (op[k] === null || op[k] === "" || (Array.isArray(op[k]) && !op[k].length && k !== "columns")) delete op[k];
      if ((op.op === "alter_column" || op.op === "drop_column") && typeof op.column !== "string") op.column = columnName ?? op.column?.name;
      if (op.op === "add_index" && columnNames?.length) op.columns = columnNames;
      if (op.op === "add_index" && Array.isArray(op.columns)) op.columns = op.columns.map((c: any) => (typeof c === "string" ? c : c?.name));
      if (op.op !== "add_table" && op.op !== "add_index") delete op.columns;
      return op;
    }),
  };
}

export interface OpResult {
  ok: boolean;
  message: string;
}

/** Apply operations to a copy of the model. Failed operations are reported and skipped. */
export function applyOperations(input: DataModel, ops: Operation[]): { model: DataModel; results: OpResult[] } {
  const model: DataModel = structuredClone(input);
  const results: OpResult[] = [];
  const findT = (name: string): Table => {
    const t = model.tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!t) throw new Error(`table "${name}" does not exist`);
    return t;
  };
  const findC = (t: Table, name: string) => {
    const c = t.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!c) throw new Error(`column "${t.name}.${name}" does not exist`);
    return c;
  };
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

  for (const op of ops) {
    try {
      let message = "";
      switch (op.op) {
        case "add_table": {
          if (model.tables.some((t) => t.name.toLowerCase() === op.table.toLowerCase())) throw new Error(`table "${op.table}" already exists`);
          const n = model.tables.length;
          const maxY = model.tables.reduce((m, t) => Math.max(m, t.position.y), 0);
          model.tables.push({
            id: uid("t_"),
            name: op.table,
            schema: op.schema,
            comment: op.comment,
            subjectArea: op.subjectArea,
            role: op.role,
            columns: op.columns.map((c) => newColumn(clean({ ...c, nullable: c.nullable ?? !c.primaryKey }))),
            indexes: [],
            position: { x: 60 + (n % 4) * 340, y: n < 4 ? 60 : maxY + 60 + Math.floor(n / 4) * 20 },
          });
          message = `Added table ${op.table} (${op.columns.length} columns)`;
          break;
        }
        case "update_table": {
          const t = findT(op.table);
          const { op: _o, table: _t, ...patch } = op;
          Object.assign(t, clean(patch));
          message = `Updated table ${t.name}`;
          break;
        }
        case "drop_table": {
          const t = findT(op.table);
          model.tables = model.tables.filter((x) => x.id !== t.id);
          model.relationships = model.relationships.filter((r) => r.fromTable !== t.id && r.toTable !== t.id);
          message = `Dropped table ${t.name}`;
          break;
        }
        case "rename_table": {
          const t = findT(op.table);
          message = `Renamed table ${t.name} → ${op.newName}`;
          t.name = op.newName;
          break;
        }
        case "set_table_comment": {
          findT(op.table).comment = op.comment;
          message = `Updated comment on ${op.table}`;
          break;
        }
        case "add_column": {
          const t = findT(op.table);
          if (t.columns.some((c) => c.name.toLowerCase() === op.column.name.toLowerCase())) throw new Error(`column "${t.name}.${op.column.name}" already exists`);
          t.columns.push(newColumn(clean({ ...op.column, nullable: op.column.nullable ?? !op.column.primaryKey })));
          message = `Added column ${t.name}.${op.column.name}`;
          break;
        }
        case "alter_column": {
          const t = findT(op.table);
          Object.assign(findC(t, op.column), clean(op.changes));
          message = `Altered column ${t.name}.${op.column}`;
          break;
        }
        case "drop_column": {
          const t = findT(op.table);
          const c = findC(t, op.column);
          t.columns = t.columns.filter((x) => x.id !== c.id);
          t.indexes = t.indexes.filter((ix) => !ix.columns.includes(c.id));
          model.relationships = model.relationships.filter((r) => !r.fromColumns.includes(c.id) && !r.toColumns.includes(c.id));
          message = `Dropped column ${t.name}.${c.name}`;
          break;
        }
        case "add_relationship": {
          const child = findT(op.fromTable), parent = findT(op.toTable);
          if (op.fromColumns.length !== op.toColumns.length) throw new Error("fromColumns and toColumns must have the same length");
          model.relationships.push({
            id: uid("r_"),
            name: op.name,
            fromTable: child.id,
            fromColumns: op.fromColumns.map((n) => findC(child, n).id),
            toTable: parent.id,
            toColumns: op.toColumns.map((n) => findC(parent, n).id),
            onDelete: op.onDelete as RefAction | undefined,
            onUpdate: op.onUpdate as RefAction | undefined,
          });
          message = `Added foreign key ${child.name}(${op.fromColumns.join(", ")}) → ${parent.name}(${op.toColumns.join(", ")})`;
          break;
        }
        case "drop_relationship": {
          const child = findT(op.fromTable);
          const ids = op.fromColumns.map((n) => findC(child, n).id).sort().join();
          const before = model.relationships.length;
          model.relationships = model.relationships.filter((r) => !(r.fromTable === child.id && [...r.fromColumns].sort().join() === ids));
          if (before === model.relationships.length) throw new Error("no such foreign key");
          message = `Dropped foreign key on ${child.name}(${op.fromColumns.join(", ")})`;
          break;
        }
        case "add_index": {
          const t = findT(op.table);
          const name = op.name || `${op.unique ? "uq" : "ix"}_${t.name}_${op.columns.join("_")}`;
          t.indexes.push({ id: uid("i_"), name, unique: !!op.unique, columns: op.columns.map((n) => findC(t, n).id) });
          message = `Added index ${name}`;
          break;
        }
        case "drop_index": {
          const t = findT(op.table);
          const before = t.indexes.length;
          t.indexes = t.indexes.filter((ix) => ix.name.toLowerCase() !== op.name.toLowerCase());
          if (before === t.indexes.length) throw new Error(`index "${op.name}" does not exist`);
          message = `Dropped index ${op.name}`;
          break;
        }
        case "set_model_info": {
          if (op.name) model.name = op.name;
          if (op.description !== undefined) model.description = op.description;
          message = "Updated model info";
          break;
        }
      }
      results.push({ ok: true, message });
    } catch (e) {
      results.push({ ok: false, message: `${op.op} failed: ${(e as Error).message}` });
    }
  }
  model.updatedAt = new Date().toISOString();
  return { model, results };
}

/** Compact text rendering of a model, used as AI context. */
export function describeModel(m: DataModel): string {
  const lines = [`Model "${m.name}" — dialect ${m.dialect}, ${m.tables.length} tables, ${m.relationships.length} foreign keys`];
  if (m.description) lines.push(`Description: ${m.description}`);
  for (const t of m.tables) {
    const tags = [t.role && `role: ${t.role}`, t.subjectArea && `subject area: ${t.subjectArea}`].filter(Boolean).join(", ");
    lines.push("", `TABLE ${t.schema ? t.schema + "." : ""}${t.name}${tags ? `  [${tags}]` : ""}${t.comment ? `  -- ${t.comment}` : ""}`);
    for (const c of t.columns) {
      const flags = [c.primaryKey && "PK", !c.nullable && !c.primaryKey && "NOT NULL", c.unique && "UNIQUE", c.autoIncrement && "AUTOINC", c.default && `DEFAULT ${c.default}`]
        .filter(Boolean).join(" ");
      lines.push(`  ${c.name} ${c.type}${flags ? " " + flags : ""}${c.comment ? `  -- ${c.comment}` : ""}`);
    }
    for (const ix of t.indexes)
      lines.push(`  ${ix.unique ? "UNIQUE " : ""}INDEX ${ix.name} (${ix.columns.map((id) => t.columns.find((c) => c.id === id)?.name).join(", ")})`);
  }
  if (m.relationships.length) lines.push("", "FOREIGN KEYS");
  for (const r of m.relationships) {
    const a = m.tables.find((t) => t.id === r.fromTable), b = m.tables.find((t) => t.id === r.toTable);
    const n = (t: Table | undefined, ids: string[]) => ids.map((id) => t?.columns.find((c) => c.id === id)?.name).join(", ");
    lines.push(`  ${a?.name}(${n(a, r.fromColumns)}) → ${b?.name}(${n(b, r.toColumns)})${r.onDelete ? ` ON DELETE ${r.onDelete}` : ""}`);
  }
  return lines.join("\n");
}
