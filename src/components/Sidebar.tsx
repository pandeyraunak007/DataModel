import { useState } from "react";
import { uid, type RefAction, type Table } from "../../shared/types.ts";
import { useStore } from "../store.ts";

const TYPES: Record<string, string[]> = {
  postgres: ["bigint", "integer", "smallint", "boolean", "varchar(255)", "text", "numeric(12,2)", "double precision", "date", "timestamp", "timestamptz", "uuid", "jsonb", "bytea"],
  mysql: ["bigint", "int", "smallint", "tinyint(1)", "varchar(255)", "text", "longtext", "decimal(12,2)", "double", "date", "datetime", "timestamp", "char(36)", "json", "blob"],
  sqlserver: ["bigint", "int", "smallint", "bit", "nvarchar(255)", "nvarchar(max)", "decimal(12,2)", "float", "date", "datetime2", "datetimeoffset", "uniqueidentifier", "varbinary(max)"],
  sqlite: ["integer", "text", "real", "numeric", "blob"],
  snowflake: ["number(38,0)", "integer", "boolean", "varchar(255)", "text", "number(12,2)", "float", "date", "timestamp_ntz", "timestamp_tz", "variant", "binary"],
};

function TableList() {
  const model = useStore((s) => s.model);
  const { select, addTable } = useStore.getState();
  const [query, setQuery] = useState("");
  const tables = model.tables.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="side-head">
        <h2>Tables <span className="count">{model.tables.length}</span></h2>
        <button className="btn small" onClick={() => addTable()}>+ Table</button>
      </div>
      <input className="input" placeholder="Filter tables" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="table-list">
        {tables.map((t) => (
          <button key={t.id} className="table-item" onClick={() => select(t.id, true)}>
            <span>{t.name}</span>
            <span className="muted">{t.columns.length}</span>
          </button>
        ))}
        {!model.tables.length && <p className="muted pad">No tables yet. Add one, reverse engineer a database, or ask the assistant to design a model.</p>}
      </div>
    </>
  );
}

function TableEditor({ table }: { table: Table }) {
  const model = useStore((s) => s.model);
  const s = useStore.getState();
  const rels = model.relationships.filter((r) => r.fromTable === table.id || r.toTable === table.id);
  const colName = (tableId: string, ids: string[]) => {
    const t = model.tables.find((x) => x.id === tableId);
    return `${t?.name}(${ids.map((id) => t?.columns.find((c) => c.id === id)?.name).join(", ")})`;
  };
  const setIndexes = (indexes: Table["indexes"]) => s.updateTable(table.id, { indexes });

  return (
    <>
      <div className="side-head">
        <button className="btn ghost small" onClick={() => s.select(null)}>← Tables</button>
        <button className="btn ghost small danger" onClick={() => s.deleteTable(table.id)}>Delete table</button>
      </div>
      <label className="field">
        <span>Table name</span>
        <input className="input" value={table.name} onChange={(e) => s.updateTable(table.id, { name: e.target.value })} />
      </label>
      <div className="row2">
        <label className="field">
          <span>Schema</span>
          <input className="input" value={table.schema ?? ""} placeholder="default" onChange={(e) => s.updateTable(table.id, { schema: e.target.value || undefined })} />
        </label>
      </div>
      <label className="field">
        <span>Comment</span>
        <textarea className="input" rows={2} value={table.comment ?? ""} onChange={(e) => s.updateTable(table.id, { comment: e.target.value || undefined })} />
      </label>

      <div className="side-head sub">
        <h3>Columns</h3>
        <button className="btn small" onClick={() => s.addColumn(table.id)}>+ Column</button>
      </div>
      <datalist id="sql-types">{(TYPES[model.dialect] ?? []).map((t) => <option key={t} value={t} />)}</datalist>
      <div className="col-grid">
        <div className="col-row head">
          <span>Name</span><span>Type</span><span title="Primary key">PK</span><span title="Not null">NN</span><span title="Unique">UQ</span><span title="Auto increment">AI</span><span />
        </div>
        {table.columns.map((c) => (
          <div className="col-row" key={c.id}>
            <input className="input tight" value={c.name} aria-label="Column name" onChange={(e) => s.updateColumn(table.id, c.id, { name: e.target.value })} />
            <input className="input tight mono" list="sql-types" value={c.type} aria-label="Column type" onChange={(e) => s.updateColumn(table.id, c.id, { type: e.target.value })} />
            <input type="checkbox" checked={c.primaryKey} aria-label="Primary key" onChange={(e) => s.updateColumn(table.id, c.id, { primaryKey: e.target.checked })} />
            <input type="checkbox" checked={!c.nullable} disabled={c.primaryKey} aria-label="Not null" onChange={(e) => s.updateColumn(table.id, c.id, { nullable: !e.target.checked })} />
            <input type="checkbox" checked={c.unique} aria-label="Unique" onChange={(e) => s.updateColumn(table.id, c.id, { unique: e.target.checked })} />
            <input type="checkbox" checked={c.autoIncrement} aria-label="Auto increment" onChange={(e) => s.updateColumn(table.id, c.id, { autoIncrement: e.target.checked })} />
            <button className="icon-btn" title="Delete column" onClick={() => s.deleteColumn(table.id, c.id)}>×</button>
            <input className="input tight span-default" placeholder="default" value={c.default ?? ""} aria-label="Default" onChange={(e) => s.updateColumn(table.id, c.id, { default: e.target.value || undefined })} />
            <input className="input tight span-comment" placeholder="comment" value={c.comment ?? ""} aria-label="Comment" onChange={(e) => s.updateColumn(table.id, c.id, { comment: e.target.value || undefined })} />
          </div>
        ))}
      </div>

      <div className="side-head sub">
        <h3>Foreign keys</h3>
      </div>
      {rels.map((r) => (
        <div className="rel-row" key={r.id}>
          <span className="mono small-text">{colName(r.fromTable, r.fromColumns)} → {colName(r.toTable, r.toColumns)}</span>
          <select className="input tight" value={r.onDelete ?? "NO ACTION"} title="On delete" onChange={(e) => s.updateRelationship(r.id, { onDelete: e.target.value as RefAction })}>
            {["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"].map((a) => <option key={a}>{a}</option>)}
          </select>
          <button className="icon-btn" title="Delete foreign key" onClick={() => s.deleteRelationship(r.id)}>×</button>
        </div>
      ))}
      {!rels.length && <p className="muted small-text">Drag from a column's edge on the canvas to a column in another table to link them.</p>}

      <div className="side-head sub">
        <h3>Indexes</h3>
        <button
          className="btn small"
          disabled={!table.columns.length}
          onClick={() => setIndexes([...table.indexes, { id: uid("i_"), name: `ix_${table.name}_${table.columns[0].name}`, columns: [table.columns[0].id], unique: false }])}
        >
          + Index
        </button>
      </div>
      {table.indexes.map((ix) => (
        <div className="index-row" key={ix.id}>
          <input className="input tight mono" value={ix.name} aria-label="Index name" onChange={(e) => setIndexes(table.indexes.map((x) => (x.id === ix.id ? { ...x, name: e.target.value } : x)))} />
          <label className="check"><input type="checkbox" checked={ix.unique} onChange={(e) => setIndexes(table.indexes.map((x) => (x.id === ix.id ? { ...x, unique: e.target.checked } : x)))} /> unique</label>
          <button className="icon-btn" title="Delete index" onClick={() => setIndexes(table.indexes.filter((x) => x.id !== ix.id))}>×</button>
          <div className="chips">
            {table.columns.map((c) => {
              const on = ix.columns.includes(c.id);
              return (
                <button
                  key={c.id}
                  className={"chip" + (on ? " on" : "")}
                  onClick={() => {
                    const columns = on ? ix.columns.filter((id) => id !== c.id) : [...ix.columns, c.id];
                    if (columns.length) setIndexes(table.indexes.map((x) => (x.id === ix.id ? { ...x, columns } : x)));
                  }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="side-head sub"><h3>Ask the assistant</h3></div>
      <div className="chips">
        <button className="chip ai" onClick={() => s.askAI(`Suggest and add any columns the "${table.name}" table is missing for its purpose. Explain each addition in one line.`)}>Suggest columns</button>
        <button className="chip ai" onClick={() => s.askAI(`Write a clear comment for the "${table.name}" table and for each of its columns, and apply them.`)}>Document table</button>
        <button className="chip ai" onClick={() => s.askAI(`Review the "${table.name}" table: keys, types, nullability, indexes, and relationships. List concrete problems; do not change anything yet.`)}>Review table</button>
      </div>
    </>
  );
}

export default function Sidebar() {
  const table = useStore((s) => s.model.tables.find((t) => t.id === s.selectedTableId));
  return <aside className={"sidebar" + (table ? " wide" : "")}>{table ? <TableEditor table={table} /> : <TableList />}</aside>;
}
