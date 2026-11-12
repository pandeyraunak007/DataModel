// Model Explorer: an object tree of everything in the model — subject areas, tables with their
// columns and indexes, relationships, and the object kinds the target platform supports.
import { useMemo, useState, type ReactNode } from "react";
import { platformLabel, ROLE_LABEL, tableRole } from "../../shared/intent.ts";
import { KINDS, kindsFor, objectsOf } from "../../shared/objects.ts";
import type { Table } from "../../shared/types.ts";
import type { Finding } from "../../shared/validate.ts";
import { useStore } from "../store.ts";

const areaOf = (t: Table) => t.subjectArea || "Unassigned";
const MAX_CHILD_COLUMNS = 40;

function Section({ id, label, count, open, toggle, onAdd, addTitle, children }: {
  id: string; label: string; count: number; open: boolean; toggle: (id: string) => void; onAdd?: () => void; addTitle?: string; children?: ReactNode;
}) {
  return (
    <div className="xsec">
      <div className={"xsec-head" + (count ? "" : " empty")}>
        <button className="xsec-toggle" onClick={() => toggle(id)} aria-expanded={open}>
          <span className="caret">{open ? "⌄" : "›"}</span>
          <span className="xsec-label">{label}</span>
          <span className="xcount">{count}</span>
        </button>
        {onAdd && <button className="xadd" title={addTitle} onClick={onAdd}>+</button>}
      </div>
      {open && <div className="xsec-body">{children}</div>}
    </div>
  );
}

export default function Explorer({ findings }: { findings: Finding[] }) {
  const model = useStore((s) => s.model);
  const selectedTable = useStore((s) => s.selectedTableId);
  const selectedObject = useStore((s) => s.selectedObjectId);
  const diagram = useStore((s) => s.diagram);
  const s = useStore.getState();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["tables"]));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const q = query.trim().toLowerCase();
  const hit = (text: string) => !q || text.toLowerCase().includes(q);
  const isOpen = (id: string, count: number) => (q ? count > 0 : open.has(id));

  const objects = objectsOf(model);
  const fkCols = useMemo(() => new Set(model.relationships.flatMap((r) => r.fromColumns)), [model.relationships]);
  const tables = useMemo(
    () => model.tables.filter((t) => hit(t.name) || t.columns.some((c) => hit(c.name))).sort((a, b) => a.name.localeCompare(b.name)),
    [model.tables, q],
  );
  const areas = [...new Set(model.tables.map(areaOf))].sort((a, b) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));
  const hasAreas = areas.some((a) => a !== "Unassigned");
  const name = (id: string) => model.tables.find((t) => t.id === id)?.name ?? "?";
  const rels = model.relationships.map((r) => ({ r, label: `${name(r.fromTable)} → ${name(r.toTable)}` })).filter((x) => hit(x.label));
  // Kinds the platform supports, plus any kind the model already contains (e.g. after changing platform).
  const kinds = KINDS.filter((k) => kindsFor(model.dialect).includes(k) || objects.some((o) => o.kind === k.kind));
  const schemas = [...new Set([...model.tables.map((t) => t.schema), ...objects.map((o) => o.schema)].filter(Boolean) as string[])].sort();

  const tableRow = (t: Table, depth: number) => {
    const role = tableRole(t);
    const key = "t:" + t.id;
    const expanded = open.has(key) || (!!q && !hit(t.name));
    const cols = q && !hit(t.name) ? t.columns.filter((c) => hit(c.name)) : t.columns;
    return (
      <div key={t.id}>
        <div className={"xrow" + (t.id === selectedTable ? " sel" : "")} style={{ paddingLeft: 6 + depth * 14 }}>
          <button className="xcaret" onClick={() => toggle(key)} aria-label={expanded ? "Collapse" : "Expand"}>{expanded ? "⌄" : "›"}</button>
          <button className="xmain" onClick={() => s.select(t.id, true)} onDoubleClick={() => s.openColumns(t.id)} title="Click to select · double-click to edit columns">
            <span className={"xchip " + (role ? "role" : "table")}>{role ? ROLE_LABEL[role] : "T"}</span>
            <span className="xname">{t.name}</span>
            <span className="xmeta">{t.columns.length}</span>
          </button>
        </div>
        {expanded && (
          <div className="xchildren" style={{ marginLeft: 17 + depth * 14 }}>
            {cols.slice(0, MAX_CHILD_COLUMNS).map((c) => (
              <button key={c.id} className="xleaf" onClick={() => s.openColumns(t.id)} title={`${c.name} ${c.type}`}>
                <span className={"xkey" + (c.primaryKey ? " pk" : fkCols.has(c.id) ? " fk" : "")}>{c.primaryKey ? "PK" : fkCols.has(c.id) ? "FK" : c.nullable ? "" : "*"}</span>
                <span className="xname">{c.name}</span>
                <span className="xtype">{c.type}</span>
              </button>
            ))}
            {cols.length > MAX_CHILD_COLUMNS && <button className="xleaf more" onClick={() => s.openColumns(t.id)}>+ {cols.length - MAX_CHILD_COLUMNS} more — open editor</button>}
            {!q && t.indexes.map((ix) => (
              <div key={ix.id} className="xleaf static" title={ix.name}>
                <span className="xkey ix">{ix.unique ? "UQ" : "IX"}</span>
                <span className="xname">{ix.name}</span>
              </div>
            ))}
            {!t.columns.length && <div className="xleaf static muted">No columns</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="explorer">
      <div className="explorer-head">
        <div className="explorer-title"><b>Model Explorer</b><span className="schematag">{platformLabel(model)}</span></div>
        <input className="search" placeholder="Search objects and columns…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="tree">
        {hasAreas && (
          <Section id="areas" label="Subject Areas" count={areas.length} open={isOpen("areas", areas.length)} toggle={toggle}>
            {areas.map((a) => {
              const inArea = tables.filter((t) => areaOf(t) === a);
              if (q && !inArea.length) return null;
              const key = "a:" + a;
              const expanded = open.has(key) || !!q;
              return (
                <div key={a}>
                  <div className={"xrow" + (diagram === a ? " sel" : "")} style={{ paddingLeft: 6 }}>
                    <button className="xcaret" onClick={() => toggle(key)} aria-label={expanded ? "Collapse" : "Expand"}>{expanded ? "⌄" : "›"}</button>
                    <button className="xmain" onClick={() => s.setDiagram(a)} title="Open this subject area's diagram">
                      <span className="xchip area">SA</span>
                      <span className="xname">{a}</span>
                      <span className="xmeta">{inArea.length}</span>
                    </button>
                  </div>
                  {expanded && inArea.map((t) => tableRow(t, 1))}
                </div>
              );
            })}
          </Section>
        )}

        <Section id="tables" label="Tables" count={tables.length} open={isOpen("tables", tables.length)} toggle={toggle} onAdd={() => s.addTable()} addTitle="New table">
          {tables.map((t) => tableRow(t, 0))}
          {!model.tables.length && <p className="xempty">No tables yet.</p>}
        </Section>

        <Section id="rels" label="Relationships" count={rels.length} open={isOpen("rels", rels.length)} toggle={toggle}>
          {rels.map(({ r, label }) => (
            <div className="xrow" key={r.id} style={{ paddingLeft: 22 }}>
              <button className="xmain" onClick={() => s.select(r.fromTable, true)} title="Select the child table">
                <span className="xchip rel">FK</span>
                <span className="xname">{label}</span>
              </button>
            </div>
          ))}
          {!rels.length && <p className="xempty">Drag between column edges on the canvas to relate tables.</p>}
        </Section>

        {kinds.map((k) => {
          const list = objects.filter((o) => o.kind === k.kind && hit(o.name)).sort((a, b) => a.name.localeCompare(b.name));
          if (q && !list.length) return null;
          return (
            <Section key={k.kind} id={k.kind} label={k.plural} count={list.length} open={isOpen(k.kind, list.length)} toggle={toggle} onAdd={() => (s.addObject(k.kind), setOpen((o) => new Set(o).add(k.kind)))} addTitle={`New ${k.label.toLowerCase()}`}>
              {list.map((o) => (
                <div className={"xrow" + (o.id === selectedObject ? " sel" : "")} key={o.id} style={{ paddingLeft: 22 }}>
                  <button className="xmain" onClick={() => s.selectObject(o.id)}>
                    <span className={"xchip obj k-" + k.kind}>{k.chip}</span>
                    <span className="xname">{o.name}</span>
                    {o.table && <span className="xmeta">on {o.table}</span>}
                  </button>
                </div>
              ))}
              {!list.length && <p className="xempty">None in this model.</p>}
            </Section>
          );
        })}

        {schemas.length > 0 && !q && (
          <Section id="schemas" label="Schemas" count={schemas.length} open={isOpen("schemas", schemas.length)} toggle={toggle}>
            {schemas.map((sc) => (
              <div className="xrow static" key={sc} style={{ paddingLeft: 22 }}>
                <span className="xchip schema">SC</span>
                <span className="xname">{sc}</span>
                <span className="xmeta">{model.tables.filter((t) => t.schema === sc).length + objects.filter((o) => o.schema === sc).length}</span>
              </div>
            ))}
          </Section>
        )}

        {!q && (
          <div className="xsec">
            <div className="xsec-head">
              <button className="xsec-toggle" onClick={() => s.setView("validation")}>
                <span className="caret">✓</span>
                <span className="xsec-label">Validation findings</span>
                <span className={"xcount" + (findings.length ? " warn" : "")}>{findings.length}</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="treefoot">
        {model.tables.length} tables · {model.relationships.length} relationships · {objects.length} other object{objects.length === 1 ? "" : "s"}
      </div>
    </aside>
  );
}
