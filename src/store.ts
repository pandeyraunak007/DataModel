import dagre from "@dagrejs/dagre";
import { create } from "zustand";
import type { OpResult } from "../shared/ops.ts";
import { emptyModel, newColumn, uid, type Column, type DataModel, type Relationship, type Table } from "../shared/types.ts";
import { api, streamChat, type SettingsView } from "./api.ts";

export type Page = "landing" | "setup" | "workspace";
export type Modal = null | "reverse" | "forward" | "compare" | "versions" | "settings";
export type View = "diagram" | "sql" | "validation";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ops?: OpResult[];
  error?: string;
  status?: string;
  /** Set when the reply carries model edits that wait for (or went through) approval. */
  proposal?: "pending" | "applied" | "discarded" | "superseded";
}

export const NODE_WIDTH = 290;
export const ROW_H = 28;
export const HEAD_H = 54;
/** Wide tables show their key columns plus enough others to reach this many rows. */
export const MAX_NODE_COLUMNS = 12;
export const relationColumns = (m: DataModel) => new Set(m.relationships.flatMap((r) => [...r.fromColumns, ...r.toColumns]));
export function visibleColumns(t: Table, relCols: Set<string>): Column[] {
  if (t.columns.length <= MAX_NODE_COLUMNS) return t.columns;
  const isKey = (c: Column) => c.primaryKey || relCols.has(c.id);
  let room = Math.max(0, MAX_NODE_COLUMNS - t.columns.filter(isKey).length);
  return t.columns.filter((c) => isKey(c) || room-- > 0);
}
export const nodeHeight = (t: Table, relCols: Set<string>) => {
  const shown = visibleColumns(t, relCols).length;
  return HEAD_H + Math.max(1, shown) * ROW_H + (shown < t.columns.length ? ROW_H : 0) + (t.indexes.length ? 30 : 0) + 5;
};

export function layoutModel(m: DataModel): DataModel {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 44, ranksep: 120, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  const rel = relationColumns(m);
  m.tables.forEach((t) => g.setNode(t.id, { width: NODE_WIDTH, height: nodeHeight(t, rel) }));
  m.relationships.forEach((r) => r.fromTable !== r.toTable && g.setEdge(r.toTable, r.fromTable));
  dagre.layout(g);
  return {
    ...m,
    tables: m.tables.map((t) => {
      const n = g.node(t.id);
      return { ...t, position: { x: Math.round(n.x - NODE_WIDTH / 2), y: Math.round(n.y - nodeHeight(t, rel) / 2) } };
    }),
  };
}

interface State {
  page: Page;
  setupMode: "create" | "edit";
  model: DataModel;
  dirty: boolean;
  past: DataModel[];
  future: DataModel[];
  selectedTableId: string | null;
  focusTableId: string | null;
  modal: Modal;
  view: View;
  /** Active diagram tab: null is the whole model, otherwise a subject area. */
  diagram: string | null;
  compareWith: DataModel | null;
  rightTab: "inspector" | "copilot";
  rightWidth: number;
  /** The column editor docked under the canvas. */
  dock: { open: boolean; height: number; max: boolean };
  fitNonce: number;
  settings: SettingsView | null;
  toast: string | null;
  chat: ChatMessage[];
  chatBusy: boolean;
  /** AI edits waiting for approval (the whole proposed model). */
  pending: { model: DataModel; messageId: string } | null;

  go: (page: Page, setupMode?: "create" | "edit") => void;
  openModal: (m: Modal) => void;
  setView: (v: View) => void;
  setDiagram: (d: string | null) => void;
  notify: (msg: string) => void;
  select: (id: string | null, focus?: boolean) => void;
  update: (fn: (m: DataModel) => DataModel, opts?: { fit?: boolean }) => void;
  load: (m: DataModel, opts?: { dirty?: boolean; layout?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  autoLayout: () => void;
  fit: () => void;
  save: () => Promise<void>;
  loadSettings: () => Promise<void>;
  setCompareWith: (m: DataModel | null) => void;

  addTable: (position?: { x: number; y: number }) => void;
  updateTable: (id: string, patch: Partial<Table>) => void;
  deleteTable: (id: string) => void;
  moveTables: (positions: Record<string, { x: number; y: number }>) => void;
  addColumn: (tableId: string) => void;
  updateColumn: (tableId: string, columnId: string, patch: Partial<Column>) => void;
  deleteColumn: (tableId: string, columnId: string) => void;
  addRelationship: (r: Omit<Relationship, "id">) => void;
  updateRelationship: (id: string, patch: Partial<Relationship>) => void;
  deleteRelationship: (id: string) => void;

  setRightTab: (t: "inspector" | "copilot") => void;
  setRightWidth: (w: number) => void;
  openColumns: (tableId?: string) => void;
  setDock: (patch: Partial<State["dock"]>) => void;
  moveColumn: (tableId: string, columnId: string, dir: -1 | 1) => void;
  addColumns: (tableId: string, columns: Partial<Column>[]) => void;
  askAI: (message: string, context?: string) => Promise<void>;
  stopAI: () => void;
  clearChat: () => void;
  applyProposal: () => void;
  discardProposal: () => void;
}

let abort: AbortController | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const mapTable = (m: DataModel, id: string, fn: (t: Table) => Table): DataModel => ({ ...m, tables: m.tables.map((t) => (t.id === id ? fn(t) : t)) });
const addedTables = (before: DataModel, after: DataModel) => after.tables.filter((t) => !before.tables.some((b) => b.id === t.id)).length;
/** Lay out when the copilot built or substantially grew the model. */
const maybeLayout = (before: DataModel, after: DataModel) => {
  const n = addedTables(before, after);
  return n >= 2 || (n > 0 && !before.tables.length) ? layoutModel(after) : after;
};

export const useStore = create<State>((set, get) => ({
  page: "landing",
  setupMode: "create",
  model: emptyModel("Untitled model"),
  dirty: false,
  past: [],
  future: [],
  selectedTableId: null,
  focusTableId: null,
  modal: null,
  view: "diagram",
  diagram: null,
  compareWith: null,
  rightTab: "inspector",
  rightWidth: Number(localStorage.getItem("dm:rightWidth")) || 380,
  dock: { open: false, height: Number(localStorage.getItem("dm:dockHeight")) || 320, max: false },
  fitNonce: 0,
  settings: null,
  toast: null,
  chat: [],
  chatBusy: false,
  pending: null,

  go: (page, setupMode) => {
    localStorage.setItem("dm:page", page);
    set((s) => ({ page, setupMode: setupMode ?? s.setupMode, modal: null }));
  },
  openModal: (modal) => set({ modal }),
  setView: (view) => set({ view }),
  setDiagram: (diagram) => set((s) => ({ diagram, view: "diagram", fitNonce: s.fitNonce + 1 })),
  notify: (toast) => {
    set({ toast });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
  select: (id, focus) =>
    set((s) => ({
      selectedTableId: id,
      focusTableId: focus ? id : null,
      view: focus ? "diagram" : s.view,
      // Selecting a table brings its inspector forward, unless the copilot is mid-reply.
      rightTab: id && !s.chatBusy ? "inspector" : s.rightTab,
    })),
  setCompareWith: (compareWith) => set({ compareWith }),

  update: (fn, opts) =>
    set((s) => {
      const next = fn(s.model);
      if (next === s.model) return s;
      return {
        model: { ...next, updatedAt: new Date().toISOString() },
        past: [...s.past.slice(-60), s.model],
        future: [],
        dirty: true,
        fitNonce: opts?.fit ? s.fitNonce + 1 : s.fitNonce,
      };
    }),

  load: (m, opts) => {
    const model = opts?.layout ? layoutModel(m) : m;
    localStorage.setItem("dm:lastModel", model.id);
    localStorage.setItem("dm:page", "workspace");
    set((s) => ({
      model, past: [], future: [], dirty: !!opts?.dirty, selectedTableId: null, chat: [], pending: null,
      page: "workspace", modal: null, view: "diagram", diagram: null, fitNonce: s.fitNonce + 1,
    }));
  },

  undo: () =>
    set((s) => (s.past.length ? { model: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.model, ...s.future], dirty: true } : s)),
  redo: () => set((s) => (s.future.length ? { model: s.future[0], future: s.future.slice(1), past: [...s.past, s.model], dirty: true } : s)),
  autoLayout: () => get().update(layoutModel, { fit: true }),
  fit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),

  save: async () => {
    try {
      const saved = await api.saveModel(get().model);
      set((s) => ({ model: { ...s.model, updatedAt: saved.updatedAt }, dirty: false }));
      get().notify("Model saved");
    } catch (e) {
      get().notify("Save failed: " + (e as Error).message);
    }
  },
  loadSettings: async () => set({ settings: await api.getSettings() }),

  addTable: (position) => {
    const { model, diagram } = get();
    const upper = model.tables.length > 0 && model.tables.every((t) => t.name === t.name.toUpperCase());
    const base = upper ? "NEW_ENTITY_" : "new_entity_";
    let n = 1;
    while (model.tables.some((t) => t.name === base + n)) n++;
    const maxX = model.tables.reduce((m, t) => Math.max(m, t.position.x), -300);
    const keyType = model.dialect === "sqlite" ? "integer" : model.dialect === "snowflake" ? "number(38,0)" : "bigint";
    const table: Table = {
      id: uid("t_"),
      name: base + n,
      subjectArea: diagram ?? undefined,
      columns: [newColumn({ name: "id", type: keyType, nullable: false, primaryKey: true, autoIncrement: true })],
      indexes: [],
      position: position ?? { x: maxX + 320, y: 60 },
    };
    get().update((m) => ({ ...m, tables: [...m.tables, table] }));
    set({ selectedTableId: table.id, focusTableId: position ? null : table.id, view: "diagram" });
  },
  updateTable: (id, patch) => get().update((m) => mapTable(m, id, (t) => ({ ...t, ...patch }))),
  deleteTable: (id) => {
    get().update((m) => ({
      ...m,
      tables: m.tables.filter((t) => t.id !== id),
      relationships: m.relationships.filter((r) => r.fromTable !== id && r.toTable !== id),
    }));
    if (get().selectedTableId === id) set({ selectedTableId: null });
  },
  moveTables: (positions) =>
    get().update((m) => ({ ...m, tables: m.tables.map((t) => (positions[t.id] ? { ...t, position: positions[t.id] } : t)) })),
  addColumn: (tableId) =>
    get().update((m) =>
      mapTable(m, tableId, (t) => {
        let n = t.columns.length + 1;
        while (t.columns.some((c) => c.name === `column_${n}`)) n++;
        return { ...t, columns: [...t.columns, newColumn({ name: `column_${n}` })] };
      }),
    ),
  updateColumn: (tableId, columnId, patch) =>
    get().update((m) =>
      mapTable(m, tableId, (t) => ({
        ...t,
        columns: t.columns.map((c) => (c.id === columnId ? { ...c, ...patch, ...(patch.primaryKey ? { nullable: false } : {}) } : c)),
      })),
    ),
  deleteColumn: (tableId, columnId) =>
    get().update((m) => ({
      ...mapTable(m, tableId, (t) => ({
        ...t,
        columns: t.columns.filter((c) => c.id !== columnId),
        indexes: t.indexes.filter((ix) => !ix.columns.includes(columnId)),
      })),
      relationships: m.relationships.filter((r) => !r.fromColumns.includes(columnId) && !r.toColumns.includes(columnId)),
    })),
  addRelationship: (r) => get().update((m) => ({ ...m, relationships: [...m.relationships, { ...r, id: uid("r_") }] })),
  updateRelationship: (id, patch) =>
    get().update((m) => ({ ...m, relationships: m.relationships.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  deleteRelationship: (id) => get().update((m) => ({ ...m, relationships: m.relationships.filter((r) => r.id !== id) })),

  setRightTab: (rightTab) => set({ rightTab }),
  setRightWidth: (w) => {
    const rightWidth = Math.round(Math.min(760, Math.max(320, w)));
    localStorage.setItem("dm:rightWidth", String(rightWidth));
    set({ rightWidth });
  },
  openColumns: (tableId) => set((s) => ({ dock: { ...s.dock, open: true }, view: "diagram", selectedTableId: tableId ?? s.selectedTableId })),
  setDock: (patch) =>
    set((s) => {
      const dock = { ...s.dock, ...patch };
      localStorage.setItem("dm:dockHeight", String(dock.height));
      return { dock };
    }),
  moveColumn: (tableId, columnId, dir) =>
    get().update((m) =>
      mapTable(m, tableId, (t) => {
        const i = t.columns.findIndex((c) => c.id === columnId), j = i + dir;
        if (i < 0 || j < 0 || j >= t.columns.length) return t;
        const columns = [...t.columns];
        [columns[i], columns[j]] = [columns[j], columns[i]];
        return { ...t, columns };
      }),
    ),
  addColumns: (tableId, cols) =>
    get().update((m) =>
      mapTable(m, tableId, (t) => {
        const taken = new Set(t.columns.map((c) => c.name.toLowerCase()));
        const fresh = cols.filter((c) => c.name && !taken.has(c.name.toLowerCase()) && taken.add(c.name.toLowerCase()));
        return fresh.length ? { ...t, columns: [...t.columns, ...fresh.map((c) => newColumn(c))] } : t;
      }),
    ),
  clearChat: () => set({ chat: [], pending: null }),
  stopAI: () => abort?.abort(),

  applyProposal: () => {
    const { pending, model } = get();
    if (!pending) return;
    const next = maybeLayout(model, pending.model);
    get().update(() => next, { fit: next !== pending.model });
    set((s) => ({ pending: null, chat: s.chat.map((m) => (m.id === pending.messageId ? { ...m, proposal: "applied" } : m)) }));
    get().notify("Changes applied to the model");
  },
  discardProposal: () =>
    set((s) => ({ pending: null, chat: s.chat.map((m) => (m.id === s.pending?.messageId ? { ...m, proposal: "discarded" } : m)) })),

  askAI: async (message, context) => {
    if (get().chatBusy || !message.trim()) return;
    const history = get().chat.filter((m) => m.text).map((m) => ({ role: m.role, text: m.text }));
    const replyId = uid("a_");
    const needsApproval = !!get().model.intent?.guardrails.approval;
    // A follow-up builds on a proposal that is still waiting, so the next proposal includes it.
    const before = get().pending?.model ?? get().model;
    // Tell the copilot what the modeler is looking at, so "this table" means something.
    const selected = before.tables.find((t) => t.id === get().selectedTableId);
    if (selected) context = `The modeler currently has the table ${selected.name} selected.` + (context ? `\n\n${context}` : "");
    set((s) => ({
      rightTab: "copilot",
      chatBusy: true,
      chat: [...s.chat, { id: uid("u_"), role: "user", text: message }, { id: replyId, role: "assistant", text: "", status: "Thinking…" }],
    }));
    const patch = (fn: (m: ChatMessage) => ChatMessage) => set((s) => ({ chat: s.chat.map((m) => (m.id === replyId ? fn(m) : m)) }));
    abort = new AbortController();
    try {
      await streamChat(
        { model: before, history, message, context },
        (e) => {
          if (e.type === "text") patch((m) => ({ ...m, text: m.text + e.delta, status: undefined }));
          else if (e.type === "status") patch((m) => ({ ...m, status: e.message }));
          else if (e.type === "ops") patch((m) => ({ ...m, ops: [...(m.ops ?? []), ...e.results], status: "Working…" }));
          else if (e.type === "error") patch((m) => ({ ...m, error: e.message, status: undefined }));
          else if (e.type === "model") {
            if (needsApproval) {
              set((s) => ({
                pending: { model: e.model, messageId: replyId },
                chat: s.chat.map((m) =>
                  m.id === replyId ? { ...m, proposal: "pending" } : m.proposal === "pending" ? { ...m, proposal: "superseded" } : m,
                ),
              }));
            } else get().update(() => e.model);
          }
        },
        abort.signal,
      );
      if (!needsApproval) {
        const laid = maybeLayout(before, get().model);
        if (laid !== get().model) set((s) => ({ model: laid, fitNonce: s.fitNonce + 1 }));
      }
    } catch (e) {
      if (!abort.signal.aborted) patch((m) => ({ ...m, error: (e as Error).message }));
    } finally {
      patch((m) => ({ ...m, status: undefined, text: m.text || (m.error || m.ops ? "" : "(stopped)") }));
      set({ chatBusy: false });
    }
  },
}));
