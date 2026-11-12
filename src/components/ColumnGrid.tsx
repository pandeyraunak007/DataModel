// Full-width column editor docked under the canvas. Built for tables with hundreds of columns:
// rows are memoised (an edit re-renders one row) and off-screen rows skip layout via content-visibility.
import { memo, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Column } from "../../shared/types.ts";
import { useStore } from "../store.ts";

export const SQL_TYPES: Record<string, string[]> = {
  postgres: ["bigint", "integer", "smallint", "boolean", "varchar(255)", "text", "numeric(12,2)", "double precision", "date", "timestamp", "timestamptz", "uuid", "jsonb", "bytea"],
  mysql: ["bigint", "int", "smallint", "tinyint(1)", "varchar(255)", "text", "longtext", "decimal(12,2)", "double", "date", "datetime", "timestamp", "char(36)", "json", "blob"],
  sqlserver: ["bigint", "int", "smallint", "bit", "nvarchar(255)", "nvarchar(max)", "decimal(12,2)", "float", "date", "datetime2", "datetimeoffset", "uniqueidentifier", "varbinary(max)"],
  sqlite: ["integer", "text", "real", "numeric", "blob"],
  snowflake: ["number(38,0)", "integer", "boolean", "varchar(255)", "text", "number(18,2)", "float", "date", "timestamp_ntz", "timestamp_tz", "variant", "binary"],
};

type Filter = "all" | "keys" | "required" | "undocumented";
const FILTERS: [Filter, string][] = [["all", "All"], ["keys", "Keys"], ["required", "Not null"], ["undocumented", "Undocumented"]];

const Row = memo(function Row({ c, n, tableId, isFk, canMove }: { c: Column; n: number; tableId: string; isFk: boolean; canMove: boolean }) {
  const s = useStore.getState();
  const set = (patch: Partial<Column>) => s.updateColumn(tableId, c.id, patch);
  return (
    <div className="cg-row" data-id={c.id}>
      <span className="cg-n">{n}</span>
      <span className="cg-key" title={c.primaryKey ? "Primary key" : isFk ? "Foreign key" : ""}>{c.primaryKey ? "🔑" : isFk ? "↳" : ""}</span>
      <input data-f="name" value={c.name} aria-label="Column name" onChange={(e) => set({ name: e.target.value })} />
      <input data-f="type" className="mono" list="sql-types" value={c.type} aria-label="Type" onChange={(e) => set({ type: e.target.value })} />
      <input type="checkbox" checked={c.primaryKey} aria-label="Primary key" onChange={(e) => set({ primaryKey: e.target.checked })} />
      <input type="checkbox" checked={!c.nullable} disabled={c.primaryKey} aria-label="Not null" onChange={(e) => set({ nullable: !e.target.checked })} />
      <input type="checkbox" checked={c.unique} aria-label="Unique" onChange={(e) => set({ unique: e.target.checked })} />
      <input type="checkbox" checked={c.autoIncrement} aria-label="Auto increment" onChange={(e) => set({ autoIncrement: e.target.checked })} />
      <input data-f="default" className="mono" value={c.default ?? ""} aria-label="Default" onChange={(e) => set({ default: e.target.value || undefined })} />
      <input data-f="comment" value={c.comment ?? ""} aria-label="Description" onChange={(e) => set({ comment: e.target.value || undefined })} />
      <span className="cg-move">
        <button className="icon-btn" title="Move up" disabled={!canMove} onClick={() => s.moveColumn(tableId, c.id, -1)}>↑</button>
        <button className="icon-btn" title="Move down" disabled={!canMove} onClick={() => s.moveColumn(tableId, c.id, 1)}>↓</button>
      </span>
      <button className="icon-btn" title="Delete column" onClick={() => s.deleteColumn(tableId, c.id)}>×</button>
    </div>
  );
});

/** "name type [not null] [primary key]" per line; tabs or commas also separate name and type. */
function parsePasted(text: string, fallbackType: string): Partial<Column>[] {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .filter((l) => l && !/^(create|\)|\(|primary key|constraint|foreign key)/i.test(l))
    .map((l) => {
      const m = l.match(/^["`\[]?([^"`\]\s,\t]+)["`\]]?[\s,\t]*(.*)$/);
      const name = m?.[1] ?? l;
      let rest = (m?.[2] ?? "").trim();
      const primaryKey = /\bprimary key\b/i.test(rest);
      const notNull = /\bnot null\b/i.test(rest) || primaryKey;
      rest = rest.replace(/\b(not null|null|primary key|unique)\b/gi, "").replace(/\bdefault\b.*$/i, "").trim();
      return { name, type: rest || fallbackType, nullable: !notNull, primaryKey };
    });
}

export default function ColumnGrid() {
  const table = useStore((s) => s.model.tables.find((t) => t.id === s.selectedTableId));
  const relationships = useStore((s) => s.model.relationships);
  const dialect = useStore((s) => s.model.dialect);
  const dock = useStore((s) => s.dock);
  const s = useStore.getState();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const fk = useMemo(() => new Set(relationships.flatMap((r) => r.fromColumns)), [relationships]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!table) return [];
    return table.columns
      .map((c, i) => ({ c, n: i + 1 }))
      .filter(({ c }) => !q || c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q) || (c.comment ?? "").toLowerCase().includes(q))
      .filter(({ c }) => filter === "all" || (filter === "keys" ? c.primaryKey || fk.has(c.id) : filter === "required" ? !c.nullable : !c.comment));
  }, [table, q, filter, fk]);
  const filtered = !!q || filter !== "all";

  const focusLast = () =>
    requestAnimationFrame(() => {
      body.current?.scrollTo({ top: body.current.scrollHeight });
      (body.current?.querySelector(".cg-row:last-of-type [data-f=name]") as HTMLInputElement | null)?.select();
    });
  const add = () => {
    if (!table) return;
    setQuery("");
    setFilter("all");
    s.addColumn(table.id);
    focusLast();
  };

  // Arrow keys and Enter move between rows within the same field, like a spreadsheet.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const f = el.dataset.f;
    if (!f || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    const row = el.closest(".cg-row");
    let next = e.key === "ArrowUp" ? row?.previousElementSibling : row?.nextElementSibling;
    if (next?.classList.contains("cg-headrow")) next = null;
    e.preventDefault();
    if (next) (next.querySelector(`[data-f="${f}"]`) as HTMLInputElement | null)?.select();
    else if (e.key === "Enter" && !filtered) add();
  };

  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const bottom = root.current!.getBoundingClientRect().bottom;
    const limit = root.current!.parentElement!.clientHeight - 120;
    const move = (ev: globalThis.PointerEvent) => s.setDock({ height: Math.round(Math.min(limit, Math.max(160, bottom - ev.clientY))), max: false });
    const up = () => (el.removeEventListener("pointermove", move), el.removeEventListener("pointerup", up));
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div className={"dock" + (dock.max ? " max" : "")} ref={root} style={dock.max ? undefined : { height: dock.height }}>
      <div className="dock-resize" onPointerDown={startResize} title="Drag to resize" />
      <div className="dock-head">
        <b>▤ {table ? table.name : "Columns"}</b>
        {table && (
          <>
            <input className="search" placeholder="Filter columns…" title="Filter by name, type or description" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="seg">
              {FILTERS.map(([id, label]) => <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>{label}</button>)}
            </div>
            <span className="hint">{filtered ? `${rows.length} / ${table.columns.length}` : table.columns.length}</span>
          </>
        )}
        <span className="spacer" />
        {table && (
          <>
            <button className="smallbtn" onClick={() => setPasting((p) => !p)} title="Add many columns at once from a pasted list">⎘ Paste</button>
            <button className="smallbtn primary" onClick={add}>＋ Column</button>
          </>
        )}
        <button className="icon-btn" title={dock.max ? "Restore" : "Maximize"} onClick={() => s.setDock({ max: !dock.max })}>{dock.max ? "▾" : "▴"}</button>
        <button className="icon-btn" title="Close column editor" onClick={() => s.setDock({ open: false, max: false })}>×</button>
      </div>

      {pasting && table && (
        <div className="dock-paste">
          <textarea
            autoFocus
            rows={4}
            placeholder={"One column per line — name, then type. Lines from a CREATE TABLE statement work too.\ncustomer_id bigint not null\nemail varchar(255)"}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div>
            <button
              className="smallbtn primary"
              disabled={!pasteText.trim()}
              onClick={() => {
                const cols = parsePasted(pasteText, SQL_TYPES[dialect]?.[4] ?? "varchar(255)");
                const before = table.columns.length;
                s.addColumns(table.id, cols);
                const added = (useStore.getState().model.tables.find((t) => t.id === table.id)?.columns.length ?? before) - before;
                s.notify(`Added ${added} column${added === 1 ? "" : "s"}${added < cols.length ? ` · skipped ${cols.length - added} duplicate name${cols.length - added === 1 ? "" : "s"}` : ""}`);
                setPasteText("");
                setPasting(false);
                focusLast();
              }}
            >
              Add {pasteText.trim() ? parsePasted(pasteText, "").length : ""} columns
            </button>
            <button className="smallbtn" onClick={() => setPasting(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!table ? (
        <p className="hint pad">Select a table on the canvas or in the explorer to edit its columns here.</p>
      ) : (
        <div className="cg" onKeyDown={onKeyDown}>
          <datalist id="sql-types">{(SQL_TYPES[dialect] ?? []).map((t) => <option key={t} value={t} />)}</datalist>
          <div className="cg-body" ref={body}>
          <div className="cg-row cg-headrow">
              <span>#</span><span /><span>Name</span><span>Type</span>
              <span title="Primary key">PK</span><span title="Not null">NN</span><span title="Unique">UQ</span><span title="Auto increment">AI</span>
              <span>Default</span><span>Description</span><span>Order</span><span />
            </div>
            {rows.map(({ c, n }) => <Row key={c.id} c={c} n={n} tableId={table.id} isFk={fk.has(c.id)} canMove={!filtered} />)}
            {!rows.length && <p className="hint pad">{table.columns.length ? "No columns match the filter." : "No columns yet. Add one, or paste a list."}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
