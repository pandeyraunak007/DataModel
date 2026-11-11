import { useEffect } from "react";
import { DIALECTS, type Dialect } from "../shared/types.ts";
import { api } from "./api.ts";
import Assistant from "./components/Assistant.tsx";
import Canvas from "./components/Canvas.tsx";
import { CompareModal, ForwardModal, ModelsModal, ReverseModal, SettingsModal, VersionsModal } from "./components/Modals.tsx";
import Sidebar from "./components/Sidebar.tsx";
import { useStore } from "./store.ts";

function TopBar() {
  const model = useStore((s) => s.model);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const assistantOpen = useStore((s) => s.assistantOpen);
  const s = useStore.getState();
  const open = (m: Parameters<typeof s.openModal>[0]) => () => (s.setCompareWith(null), s.openModal(m));
  return (
    <header className="topbar">
      <div className="brand" title="DataModel Studio">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="3" width="9" height="7" rx="1.5" fill="currentColor" />
          <rect x="13" y="14" width="9" height="7" rx="1.5" fill="currentColor" opacity=".55" />
          <path d="M6.5 10v4.5a3 3 0 0 0 3 3H13" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
      <input className="model-name" value={model.name} aria-label="Model name" onChange={(e) => s.update((m) => ({ ...m, name: e.target.value }))} />
      <select className="input dialect" value={model.dialect} title="Model dialect" onChange={(e) => s.update((m) => ({ ...m, dialect: e.target.value as Dialect }))}>
        {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      <nav>
        <button className="btn ghost" onClick={open("models")}>Models</button>
        <button className="btn ghost" onClick={open("reverse")}>Reverse engineer</button>
        <button className="btn ghost" onClick={open("forward")}>Forward engineer</button>
        <button className="btn ghost" onClick={open("compare")}>Compare</button>
        <button className="btn ghost" onClick={open("versions")}>Versions</button>
      </nav>
      <span className="spacer" />
      <button className="btn ghost" disabled={!canUndo} onClick={s.undo} title="Undo (⌘Z)">Undo</button>
      <button className="btn ghost" disabled={!canRedo} onClick={s.redo} title="Redo (⇧⌘Z)">Redo</button>
      <button className="btn ghost" onClick={s.autoLayout} disabled={!model.tables.length}>Auto layout</button>
      <button className="btn primary" onClick={s.save} title="Save (⌘S)">{dirty ? "Save •" : "Saved"}</button>
      <button className="btn ghost" onClick={open("settings")}>Settings</button>
      {!assistantOpen && <button className="btn" onClick={() => s.toggleAssistant(true)}>Assistant</button>}
    </header>
  );
}

function EmptyState() {
  const s = useStore.getState();
  return (
    <div className="empty">
      <h1>Start a data model</h1>
      <p>Bring in an existing database, describe what you need, or draw it yourself.</p>
      <div className="empty-actions">
        <button className="btn primary" onClick={() => s.openModal("reverse")}>Reverse engineer a database</button>
        <button className="btn" onClick={() => s.addTable({ x: 80, y: 80 })}>Add a table</button>
        <button className="btn" onClick={() => s.openModal("models")}>Open a saved model</button>
      </div>
      <p className="muted small-text">Or tell the assistant what to build — it edits the diagram directly. Double-click the canvas to add a table.</p>
    </div>
  );
}

export default function App() {
  const modal = useStore((s) => s.modal);
  const assistantOpen = useStore((s) => s.assistantOpen);
  const toast = useStore((s) => s.toast);
  const isEmpty = useStore((s) => s.model.tables.length === 0);

  useEffect(() => {
    const s = useStore.getState();
    s.loadSettings().catch(() => s.notify("The app server is not reachable"));
    const last = localStorage.getItem("dm:lastModel");
    if (last) api.getModel(last).then((m) => s.load(m)).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if (e.key === "s") (e.preventDefault(), useStore.getState().save());
      else if (e.key === "z" && !typing) (e.preventDefault(), e.shiftKey ? useStore.getState().redo() : useStore.getState().undo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <Sidebar />
        <main className="canvas">
          <Canvas />
          {isEmpty && <EmptyState />}
        </main>
        {assistantOpen && <Assistant />}
      </div>
      {modal === "models" && <ModelsModal />}
      {modal === "reverse" && <ReverseModal />}
      {modal === "forward" && <ForwardModal />}
      {modal === "compare" && <CompareModal />}
      {modal === "versions" && <VersionsModal />}
      {modal === "settings" && <SettingsModal />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
