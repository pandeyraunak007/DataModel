import dagre from "@dagrejs/dagre";
import { create } from "zustand";
import type { OpResult } from "../shared/ops.ts";
import { emptyModel, newColumn, uid, type Column, type DataModel, type Dialect, type Relationship, type Table } from "../shared/types.ts";
import { api, streamChat, type SettingsView } from "./api.ts";

export type Modal = null | "models" | "reverse" | "forward" | "compare" | "versions" | "settings";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ops?: OpResult[];
  error?: string;
  status?: string;
}

export const NODE_WIDTH = 270;
export const nodeHeight = (t: Table) => 40 + Math.max(1, t.columns.length) * 26 + 8;

export function layoutModel(m: DataModel): DataModel {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 110, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  m.tables.forEach((t) => g.setNode(t.id, { width: NODE_WIDTH, height: nodeHeight(t) }));
  m.relationships.forEach((r) => r.fromTable !== r.toTable && g.setEdge(r.toTable, r.fromTable));
  dagre.layout(g);
  return {
    ...m,
    tables: m.tables.map((t) => {
      const n = g.node(t.id);
      return { ...t, position: { x: Math.round(n.x - NODE_WIDTH / 2), y: Math.round(n.y - nodeHeight(t) / 2) } };
    }),
  };
}

interface State {
  model: DataModel;
  dirty: boolean;
  past: DataModel[];
  future: DataModel[];
  selectedTableId: string | null;
  focusTableId: string | null;
  modal: Modal;
  compareWith: DataModel | null; // a model handed to the Compare dialog (live database / old version)
  assistantOpen: boolean;
  fitNonce: number;
  settings: SettingsView | null;
  toast: string | null;
  chat: ChatMessage[];
  chatBusy: boolean;

  openModal: (m: Modal) => void;
  notify: (msg: string) => void;
  select: (id: string | null, focus?: boolean) => void;
  update: (fn: (m: DataModel) => DataModel, opts?: { fit?: boolean }) => void;
  load: (m: DataModel, opts?: { dirty?: boolean; layout?: boolean }) => void;
  newModel: (name: string, dialect: Dialect) => void;
  undo: () => void;
  redo: () => void;
  autoLayout: () => void;
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

  toggleAssistant: (open?: boolean) => void;
  askAI: (message: string, context?: string) => Promise<void>;
  stopAI: () => void;
  clearChat: () => void;
}

let abort: AbortController | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const mapTable = (m: DataModel, id: string, fn: (t: Table) => Table): DataModel => ({ ...m, tables: m.tables.map((t) => (t.id === id ? fn(t) : t)) });

export const useStore = create<State>((set, get) => ({
  model: emptyModel("Untitled model"),
  dirty: false,
  past: [],
  future: [],
  selectedTableId: null,
  focusTableId: null,
  modal: null,
  compareWith: null,
  assistantOpen: true,
  fitNonce: 0,
  settings: null,
  toast: null,
  chat: [],
  chatBusy: false,

  openModal: (modal) => set({ modal }),
  notify: (toast) => {
    set({ toast });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
  select: (id, focus) => set({ selectedTableId: id, focusTableId: focus ? id : null }),
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
    set((s) => ({ model, past: [], future: [], dirty: !!opts?.dirty, selectedTableId: null, chat: [], fitNonce: s.fitNonce + 1 }));
  },
  newModel: (name, dialect) => get().load(emptyModel(name, dialect), { dirty: true }),

  undo: () =>
    set((s) => (s.past.length ? { model: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.model, ...s.future], dirty: true } : s)),
  redo: () => set((s) => (s.future.length ? { model: s.future[0], future: s.future.slice(1), past: [...s.past, s.model], dirty: true } : s)),
  autoLayout: () => get().update(layoutModel, { fit: true }),

  save: async () => {
    try {
      const saved = await api.saveModel(get().model);
      localStorage.setItem("dm:lastModel", saved.id);
      set((s) => ({ model: { ...s.model, updatedAt: saved.updatedAt }, dirty: false }));
      get().notify("Model saved");
    } catch (e) {
      get().notify("Save failed: " + (e as Error).message);
    }
  },
  loadSettings: async () => set({ settings: await api.getSettings() }),

  addTable: (position) => {
    const { model } = get();
    let n = model.tables.length + 1;
    while (model.tables.some((t) => t.name === `table_${n}`)) n++;
    const maxX = model.tables.reduce((m, t) => Math.max(m, t.position.x), -300);
    const table: Table = {
      id: uid("t_"),
      name: `table_${n}`,
      columns: [newColumn({ name: "id", type: model.dialect === "sqlite" ? "integer" : "bigint", nullable: false, primaryKey: true, autoIncrement: true })],
      indexes: [],
      position: position ?? { x: maxX + 320, y: 60 },
    };
    get().update((m) => ({ ...m, tables: [...m.tables, table] }));
    set({ selectedTableId: table.id, focusTableId: position ? null : table.id });
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

  toggleAssistant: (open) => set((s) => ({ assistantOpen: open ?? !s.assistantOpen })),
  clearChat: () => set({ chat: [] }),
  stopAI: () => abort?.abort(),

  askAI: async (message, context) => {
    if (get().chatBusy || !message.trim()) return;
    const history = get().chat.filter((m) => m.text).map((m) => ({ role: m.role, text: m.text }));
    const replyId = uid("a_");
    const before = get().model;
    set((s) => ({
      assistantOpen: true,
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
          else if (e.type === "model") get().update(() => e.model);
          else if (e.type === "error") patch((m) => ({ ...m, error: e.message, status: undefined }));
        },
        abort.signal,
      );
      // Lay out the diagram when the assistant built or substantially grew the model.
      const after = get().model;
      const added = after.tables.filter((t) => !before.tables.some((b) => b.id === t.id)).length;
      if (added >= 2 || (added && !before.tables.length)) {
        set((s) => ({ model: layoutModel(s.model), fitNonce: s.fitNonce + 1 }));
      }
    } catch (e) {
      if (!abort.signal.aborted) patch((m) => ({ ...m, error: (e as Error).message }));
    } finally {
      patch((m) => ({ ...m, status: undefined, text: m.text || (m.error || m.ops ? "" : "(stopped)") }));
      set({ chatBusy: false });
    }
  },
}));
