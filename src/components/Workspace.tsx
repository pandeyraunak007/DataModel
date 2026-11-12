import { useDeferredValue, useMemo, useState, type PointerEvent } from "react";
import { createTableSQL, generateDDL } from "../../shared/ddl.ts";
import { modelSubtitle } from "../../shared/intent.ts";
import type { DataModel, Table } from "../../shared/types.ts";
import { validateModel, type Finding } from "../../shared/validate.ts";
import { download } from "../api.ts";
import { useStore } from "../store.ts";
import Copilot from "./Assistant.tsx";
import Canvas, { zoom } from "./Canvas.tsx";
import ColumnGrid from "./ColumnGrid.tsx";
import Explorer from "./Explorer.tsx";
import Inspector from "./Inspector.tsx";

const areaOf = (t: Table) => t.subjectArea || "Unassigned";
const areasOf = (m: DataModel) => [...new Set(m.tables.map(areaOf))].sort((a, b) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));

function ModelBar({ findings }: { findings: Finding[] }) {
  const model = useStore((s) => s.model);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const s = useStore.getState();
  const open = (m: Parameters<typeof s.openModal>[0]) => () => (s.setCompareWith(null), s.openModal(m));
  return (
    <div className="modelbar">
      <div className="modelbar-title">
        <input className="model-name" value={model.name} aria-label="Model name" onChange={(e) => s.update((m) => ({ ...m, name: e.target.value }))} />
        <button className="model-meta" title="Edit modeling context" onClick={() => s.go("setup", "edit")}>{modelSubtitle(model)} ✎</button>
      </div>
      <div className="right-actions">
        <button className="smallbtn" disabled={!canUndo} onClick={s.undo} title="Undo (⌘Z)">↶</button>
        <button className="smallbtn" disabled={!canRedo} onClick={s.redo} title="Redo (⇧⌘Z)">↷</button>
        <span className="sep" />
        <button className="smallbtn" onClick={open("reverse")}>⇣ Reverse engineer</button>
        <button className="smallbtn" onClick={open("forward")}>⇡ Forward engineer</button>
        <button className="smallbtn" onClick={open("compare")}>⇄ Compare</button>
        <button className="smallbtn" onClick={open("versions")}>◷ Versions</button>
        <span className="sep" />
        <button className="smallbtn" onClick={() => (s.setView("validation"), s.notify(findings.length ? `Validation completed · ${findings.length} recommendation${findings.length === 1 ? "" : "s"}` : "Validation completed · no findings"))}>✓ Validate</button>
        <button className="smallbtn" onClick={s.save} title="Save (⌘S)">{dirty ? "Save •" : "Saved"}</button>
        <button className="smallbtn primary" onClick={() => s.addTable()}>＋ New entity</button>
      </div>
    </div>
  );
}

function ValidationView({ findings }: { findings: Finding[] }) {
  const s = useStore.getState();
  const hasIntent = useStore((st) => !!st.model.intent);
  const [cat, setCat] = useState<string>("All");
  const cats = ["All", ...new Set(findings.map((f) => f.category))];
  const shown = findings.filter((f) => cat === "All" || f.category === cat);
  return (
    <div className="panel-view">
      <div className="rec-layout">
        <div className="rec-side">
          <h3>Validation</h3>
          {cats.map((c) => (
            <button key={c} className={"rec-filter" + (c === cat ? " active" : "")} onClick={() => setCat(c)}>
              {c} <span>{c === "All" ? findings.length : findings.filter((f) => f.category === c).length}</span>
            </button>
          ))}
          <p className="hint pad-top">{hasIntent ? "Rules follow the declared methodology and guardrails." : "Only general rules apply until a modeling context is set."}</p>
          {findings.length > 0 && (
            <button className="smallbtn block" onClick={() => s.askAI("Here are the current validation findings. Prioritise them for this model's methodology, say which are real problems and which are acceptable here, and propose fixes for the real ones.", findings.map((f) => `[${f.severity}] ${f.table ?? "model"}: ${f.title} — ${f.detail}`).join("\n"))}>✧ Triage with copilot</button>
          )}
        </div>
        <div className="rec-main">
          {!shown.length && <div className="rec"><b>No findings</b><p>Nothing to review under the current rules. Findings are review candidates, so a clean result is not proof the design is right — ask the copilot for a deeper review.</p></div>}
          {shown.map((f) => (
            <div className="rec" key={f.id}>
              <span className={"severity " + f.severity}>{f.severity}</span>
              <b>{f.title}{f.table ? ` · ${f.table}` : ""}</b>
              <p>{f.detail}</p>
              <div className="rec-actions">
                {f.tableId && <button onClick={() => s.select(f.tableId!, true)}>Show on canvas</button>}
                <button onClick={() => s.askAI(`Explain this validation finding${f.table ? ` on ${f.table}` : ""} and whether it matters under this model's methodology.`, `${f.title}: ${f.detail}`)}>Ask AI why</button>
                <button className="primary" onClick={() => s.askAI(`Fix this validation finding${f.table ? ` on ${f.table}` : ""} in a way that fits the model's methodology and guardrails.`, `${f.title}: ${f.detail}`)}>✧ Fix with copilot</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SqlView() {
  const model = useStore((s) => s.model);
  const table = useStore((s) => s.model.tables.find((t) => t.id === s.selectedTableId));
  const notify = useStore((s) => s.notify);
  const sql = useMemo(() => (table ? createTableSQL(model, table, model.dialect) : generateDDL(model, model.dialect)), [model, table]);
  return (
    <div className="panel-view">
      <div className="sql-head">
        <b>{table ? `SQL preview · ${table.name}` : "SQL preview · whole model"}</b>
        <span className="hint">{table ? "Clear the selection to see the whole model." : "Select a table to preview just that table."} For other platforms and options, use Forward engineer.</span>
        <span className="spacer" />
        <button className="smallbtn" onClick={() => navigator.clipboard.writeText(sql).then(() => notify("Copied"))}>Copy</button>
        <button className="smallbtn" onClick={() => download(`${model.name.replace(/\W+/g, "_")}.sql`, sql)}>Download</button>
      </div>
      <pre className="code">{sql}</pre>
    </div>
  );
}

function EmptyCanvas() {
  const s = useStore.getState();
  const hasIntent = useStore((st) => !!st.model.intent);
  return (
    <div className="empty">
      <h2>This model is empty</h2>
      <p>Bring in an existing database, let the copilot draft a starting point, or add entities yourself.</p>
      <div className="btn-row">
        {hasIntent && <button className="btn primary" onClick={() => s.askAI("Draft a starter model that fits the declared modeling context: the core tables, keys and relationships for this domain and workload, organised into subject areas.")}>✧ Draft a starter model</button>}
        <button className="btn" onClick={() => s.openModal("reverse")}>Reverse engineer a database</button>
        <button className="btn" onClick={() => s.addTable({ x: 80, y: 80 })}>＋ New entity</button>
      </div>
      <p className="hint">Double-click the canvas to add an entity where you click.</p>
    </div>
  );
}

export default function Workspace() {
  const model = useStore((s) => s.model);
  const view = useStore((s) => s.view);
  const diagram = useStore((s) => s.diagram);
  const rightTab = useStore((s) => s.rightTab);
  const rightWidth = useStore((s) => s.rightWidth);
  const dock = useStore((s) => s.dock);
  const selectedName = useStore((s) => (s.model.objects ?? []).find((o) => o.id === s.selectedObjectId)?.name ?? s.model.tables.find((t) => t.id === s.selectedTableId)?.name);
  const chatBusy = useStore((s) => s.chatBusy);
  const hasProposal = useStore((s) => !!s.pending);
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => useStore.getState().setRightWidth(window.innerWidth - ev.clientX);
    const up = () => (el.removeEventListener("pointermove", move), el.removeEventListener("pointerup", up));
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const s = useStore.getState();
  const deferredModel = useDeferredValue(model);
  const findings = useMemo(() => validateModel(deferredModel), [deferredModel]);
  const areas = areasOf(model);
  const tabs = areas.length > 1 || (areas.length === 1 && areas[0] !== "Unassigned") ? areas : [];

  return (
    <section className="workspace">
      <ModelBar findings={findings} />
      <div className="workgrid" style={{ "--rw": rightWidth + "px" } as React.CSSProperties}>
        <Explorer findings={findings} />
        <section className="canvasarea">
          <div className="canvashead">
            <button className={"diagramtab" + (diagram === null ? " active" : "")} onClick={() => s.setDiagram(null)}>Model overview</button>
            {tabs.map((a) => <button key={a} className={"diagramtab" + (diagram === a ? " active" : "")} onClick={() => s.setDiagram(a)}>{a}</button>)}
          </div>
          <div className={"canvas" + (dock.open && dock.max && view === "diagram" ? " collapsed" : "")}>
            <Canvas />
            {view === "diagram" && (
              <div className="canvas-tools">
                <button onClick={() => s.addTable()}>＋ Entity</button>
                <button onClick={s.autoLayout} disabled={!model.tables.length}>✣ Auto layout</button>
                <button onClick={s.fit}>⤢ Fit</button>
                <span className="tool-hint">Drag between column edges to relate tables</span>
              </div>
            )}
            {view === "diagram" && !model.tables.length && <EmptyCanvas />}
            {view === "validation" && <ValidationView findings={findings} />}
            {view === "sql" && <SqlView />}
          </div>
          {dock.open && view === "diagram" && <ColumnGrid />}
          <div className="bottom">
            <button className={view === "diagram" ? "active" : ""} onClick={() => s.setView("diagram")}>▦ Diagram</button>
            <button className={dock.open && view === "diagram" ? "active" : ""} onClick={() => (dock.open && view === "diagram" ? s.setDock({ open: false, max: false }) : s.openColumns())}>▤ Columns</button>
            <button className={view === "sql" ? "active" : ""} onClick={() => s.setView("sql")}>⌘ SQL Preview</button>
            <button className={view === "validation" ? "active" : ""} onClick={() => s.setView("validation")}>✓ Validation · {findings.length} recommendation{findings.length === 1 ? "" : "s"}</button>
            <span className="spacer" />
            <button onClick={() => zoom.out()} title="Zoom out">−</button>
            <button onClick={() => zoom.in()} title="Zoom in">＋</button>
          </div>
        </section>
        <aside className="inspector">
          <div className="right-resize" onPointerDown={startResize} title="Drag to resize" />
          <div className="rtabs" role="tablist">
            <button role="tab" aria-selected={rightTab === "inspector"} className={rightTab === "inspector" ? "active" : ""} onClick={() => s.setRightTab("inspector")}>
              Inspector{selectedName ? <span className="rtab-sub">{selectedName}</span> : null}
            </button>
            <button role="tab" aria-selected={rightTab === "copilot"} className={rightTab === "copilot" ? "active" : ""} onClick={() => s.setRightTab("copilot")}>
              ✧ Copilot{chatBusy ? <span className="rtab-dot busy" title="Working" /> : hasProposal ? <span className="rtab-dot" title="Changes waiting for approval" /> : null}
            </button>
          </div>
          <div className={"rpane" + (rightTab === "inspector" ? "" : " hidden")}><Inspector /></div>
          <div className={"rpane" + (rightTab === "copilot" ? "" : " hidden")}><Copilot /></div>
        </aside>
      </div>
    </section>
  );
}
