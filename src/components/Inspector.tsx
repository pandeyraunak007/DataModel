import { useDeferredValue, useMemo, useState } from "react";
import { modelSubtitle, pattern, ROLE_LABEL, tableRole } from "../../shared/intent.ts";
import { uid, type RefAction, type Table, type TableRole } from "../../shared/types.ts";
import { validateModel } from "../../shared/validate.ts";
import { useStore } from "../store.ts";
import { SQL_TYPES } from "./ColumnGrid.tsx";

type Tab = "Properties" | "Columns" | "Relationships" | "Physical";

function ModelProfile() {
  const model = useStore((s) => s.model);
  const s = useStore.getState();
  const i = model.intent;
  return (
    <>
      <div className="object-title">
        <div className="objicon">◇</div>
        <div><b>{model.name}</b><small>{modelSubtitle(model)}</small></div>
      </div>
      {i ? (
        <>
          <div className="prop"><span>Pattern</span><span>{pattern(i.pattern).name}</span></div>
          <div className="prop"><span>Domain</span><span>{i.domain}</span></div>
          <div className="prop"><span>Workload</span><span>{i.purpose}</span></div>
          {pattern(i.pattern).fields.filter((f) => i.details[f.key]).map((f) => <div className="prop" key={f.key}><span>{f.label}</span><span>{i.details[f.key]}</span></div>)}
          <div className="prop"><span>Naming</span><span>{i.naming}</span></div>
          <div className="prop"><span>Key strategy</span><span>{i.pkStrategy}</span></div>
          <div className="prop"><span>AI changes</span><span>{i.guardrails.approval ? "Need approval" : "Applied directly"}</span></div>
        </>
      ) : (
        <div className="inline-reco">
          <b>✧ No modeling context yet</b>
          <p>Declare the methodology, domain and guardrails so validation and the copilot can judge this model by the right rules.</p>
        </div>
      )}
      <button className="smallbtn block" onClick={() => s.go("setup", "edit")}>{i ? "Edit modeling context" : "Set up modeling context"}</button>
      <p className="hint pad-top">Select a table on the canvas or in the explorer to inspect and edit it.</p>
    </>
  );
}

function TableInspector({ table }: { table: Table }) {
  const model = useStore((s) => s.model);
  const s = useStore.getState();
  const [tab, setTab] = useState<Tab>("Properties");
  const [colQuery, setColQuery] = useState("");
  const [openCol, setOpenCol] = useState<string | null>(null);
  const fkCols = useMemo(() => new Set(model.relationships.flatMap((r) => r.fromColumns)), [model.relationships]);
  const role = tableRole(table);
  const deferredModel = useDeferredValue(model);
  const findings = useMemo(() => validateModel(deferredModel).filter((f) => f.tableId === table.id), [deferredModel, table.id]);
  const rels = model.relationships.filter((r) => r.fromTable === table.id || r.toTable === table.id);
  const areas = [...new Set(model.tables.map((t) => t.subjectArea).filter(Boolean))] as string[];
  const end = (tableId: string, ids: string[]) => {
    const t = model.tables.find((x) => x.id === tableId);
    return `${t?.name}(${ids.map((id) => t?.columns.find((c) => c.id === id)?.name).join(", ")})`;
  };
  const setIndexes = (indexes: Table["indexes"]) => s.updateTable(table.id, { indexes });
  const top = findings[0];

  return (
    <>
      <div className="object-title">
        <div className="objicon">▤</div>
        <div>
          <b>{table.name}</b>
          <small>{role ? ROLE_LABEL[role] + " table" : "Table"} · {table.subjectArea || "No subject area"}</small>
        </div>
      </div>
      <div className="ins-nav">
        {(["Properties", "Columns", "Relationships", "Physical"] as Tab[]).map((t) => (
          <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
            {t}{t === "Columns" ? ` (${table.columns.length})` : t === "Relationships" ? ` (${rels.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "Properties" && (
        <>
          <div className="prop"><span>Name</span><input value={table.name} onChange={(e) => s.updateTable(table.id, { name: e.target.value })} /></div>
          <div className="prop"><span>Schema</span><input value={table.schema ?? ""} placeholder="default" onChange={(e) => s.updateTable(table.id, { schema: e.target.value || undefined })} /></div>
          <div className="prop">
            <span>Subject area</span>
            <input list="subject-areas" value={table.subjectArea ?? ""} placeholder="Unassigned" onChange={(e) => s.updateTable(table.id, { subjectArea: e.target.value || undefined })} />
            <datalist id="subject-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
          </div>
          <div className="prop">
            <span>Role</span>
            <select value={table.role ?? ""} onChange={(e) => s.updateTable(table.id, { role: (e.target.value || undefined) as TableRole | undefined })}>
              <option value="">{role && !table.role ? `Auto (${ROLE_LABEL[role]})` : "Not set"}</option>
              {Object.entries(ROLE_LABEL).map(([k]) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
            </select>
          </div>
          <div className="prop col"><span>Description</span><textarea rows={2} value={table.comment ?? ""} onChange={(e) => s.updateTable(table.id, { comment: e.target.value || undefined })} /></div>
          <div className="prop"><span>Columns</span><span>{table.columns.length} · {table.columns.filter((c) => c.primaryKey).length} PK · {table.columns.filter((c) => fkCols.has(c.id)).length} FK</span></div>
          <div className="prop"><span>Relationships</span><span>{rels.length}</span></div>
          <div className="prop"><span>Indexes</span><span>{table.indexes.length}</span></div>
          <button className="smallbtn block" onClick={() => s.openColumns(table.id)}>▤ Open column editor</button>
        </>
      )}

      {tab === "Columns" && (
        <>
          <div className="col-tools">
            <input className="search" placeholder={`Filter ${table.columns.length} columns…`} value={colQuery} onChange={(e) => setColQuery(e.target.value)} />
            <button className="smallbtn" onClick={() => s.openColumns(table.id)} title="Edit all columns in a full-width grid">⤢ Grid</button>
          </div>
          <datalist id="sql-types-i">{(SQL_TYPES[model.dialect] ?? []).map((t) => <option key={t} value={t} />)}</datalist>
          <div className="col-list">
            {table.columns
              .filter((c) => !colQuery || c.name.toLowerCase().includes(colQuery.toLowerCase()) || c.type.toLowerCase().includes(colQuery.toLowerCase()))
              .map((c) =>
                openCol === c.id ? (
                  <div className="col-edit" key={c.id}>
                    <div className="col-edit-head">
                      <input value={c.name} aria-label="Column name" autoFocus onChange={(e) => s.updateColumn(table.id, c.id, { name: e.target.value })} />
                      <button className="icon-btn" title="Done" onClick={() => setOpenCol(null)}>✓</button>
                    </div>
                    <div className="prop"><span>Type</span><input className="mono" list="sql-types-i" value={c.type} onChange={(e) => s.updateColumn(table.id, c.id, { type: e.target.value })} /></div>
                    <div className="flags">
                      <label><input type="checkbox" checked={c.primaryKey} onChange={(e) => s.updateColumn(table.id, c.id, { primaryKey: e.target.checked })} /> Primary key</label>
                      <label><input type="checkbox" checked={!c.nullable} disabled={c.primaryKey} onChange={(e) => s.updateColumn(table.id, c.id, { nullable: !e.target.checked })} /> Not null</label>
                      <label><input type="checkbox" checked={c.unique} onChange={(e) => s.updateColumn(table.id, c.id, { unique: e.target.checked })} /> Unique</label>
                      <label><input type="checkbox" checked={c.autoIncrement} onChange={(e) => s.updateColumn(table.id, c.id, { autoIncrement: e.target.checked })} /> Auto increment</label>
                    </div>
                    <div className="prop"><span>Default</span><input className="mono" value={c.default ?? ""} onChange={(e) => s.updateColumn(table.id, c.id, { default: e.target.value || undefined })} /></div>
                    <div className="prop col"><span>Description</span><textarea rows={2} value={c.comment ?? ""} onChange={(e) => s.updateColumn(table.id, c.id, { comment: e.target.value || undefined })} /></div>
                    <button className="smallbtn danger" onClick={() => s.deleteColumn(table.id, c.id)}>Delete column</button>
                  </div>
                ) : (
                  <button className="col-item" key={c.id} onClick={() => setOpenCol(c.id)} title="Click to edit">
                    <span className="keymark">{c.primaryKey ? "🔑" : fkCols.has(c.id) ? "↳" : ""}</span>
                    <span className="colname">{c.name}</span>
                    <em>{c.type}{!c.nullable && !c.primaryKey ? " •" : ""}</em>
                  </button>
                ),
              )}
          </div>
          <button className="smallbtn block" onClick={() => { s.addColumn(table.id); setColQuery(""); const t = useStore.getState().model.tables.find((x) => x.id === table.id); setOpenCol(t?.columns[t.columns.length - 1].id ?? null); }}>＋ Add column</button>
        </>
      )}

      {tab === "Relationships" && (
        <>
          {rels.map((r) => (
            <div className="rel-row" key={r.id}>
              <span className="mono">{end(r.fromTable, r.fromColumns)} → {end(r.toTable, r.toColumns)}</span>
              <select value={r.onDelete ?? "NO ACTION"} title="On delete" onChange={(e) => s.updateRelationship(r.id, { onDelete: e.target.value as RefAction })}>
                {["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"].map((a) => <option key={a}>{a}</option>)}
              </select>
              <button className="icon-btn" title="Delete relationship" onClick={() => s.deleteRelationship(r.id)}>×</button>
            </div>
          ))}
          <p className="hint">To add a relationship, drag from the edge of a column on the canvas to the column it references.</p>
        </>
      )}

      {tab === "Physical" && (
        <>
          <div className="mini-head">Indexes ({table.indexes.length})</div>
          {table.indexes.map((ix) => (
            <div className="index-row" key={ix.id}>
              <input className="mono" value={ix.name} aria-label="Index name" onChange={(e) => setIndexes(table.indexes.map((x) => (x.id === ix.id ? { ...x, name: e.target.value } : x)))} />
              <label><input type="checkbox" checked={ix.unique} onChange={(e) => setIndexes(table.indexes.map((x) => (x.id === ix.id ? { ...x, unique: e.target.checked } : x)))} /> unique</label>
              <button className="icon-btn" title="Delete index" onClick={() => setIndexes(table.indexes.filter((x) => x.id !== ix.id))}>×</button>
              <div className="chips">
                {table.columns.map((c) => {
                  const on = ix.columns.includes(c.id);
                  return (
                    <button key={c.id} className={"chip" + (on ? " on" : "")} onClick={() => {
                      const columns = on ? ix.columns.filter((id) => id !== c.id) : [...ix.columns, c.id];
                      if (columns.length) setIndexes(table.indexes.map((x) => (x.id === ix.id ? { ...x, columns } : x)));
                    }}>{c.name}</button>
                  );
                })}
              </div>
            </div>
          ))}
          <button className="smallbtn block" disabled={!table.columns.length} onClick={() => setIndexes([...table.indexes, { id: uid("i_"), name: `ix_${table.name}_${table.columns[0].name}`.toLowerCase(), columns: [table.columns[0].id], unique: false }])}>＋ Add index</button>
          <button className="smallbtn block danger" onClick={() => s.deleteTable(table.id)}>Delete table</button>
        </>
      )}

      <div className="inline-reco">
        <b>✧ Intent-aware recommendation</b>
        {top ? (
          <>
            <p><strong>{top.title}.</strong> {top.detail}{findings.length > 1 ? ` (+${findings.length - 1} more in Validation)` : ""}</p>
            <button onClick={() => s.askAI(`Explain this validation finding on ${table.name} and how to resolve it under this model's methodology.`, `${top.title}: ${top.detail}`)}>Ask AI why →</button>
          </>
        ) : (
          <>
            <p>No validation findings for this table. Ask the copilot for a deeper review against the modeling context.</p>
            <button onClick={() => s.askAI(`Review the ${table.name} table against this model's methodology and declared context: keys, types, nullability, relationships and history handling. List concrete review candidates; do not change anything yet.`)}>Review with AI →</button>
          </>
        )}
      </div>
    </>
  );
}

export default function Inspector() {
  const table = useStore((s) => s.model.tables.find((t) => t.id === s.selectedTableId));
  return <div className="inspect-scroll">{table ? <TableInspector key={table.id} table={table} /> : <ModelProfile />}</div>;
}
