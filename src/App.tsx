import { useEffect } from "react";
import { api } from "./api.ts";
import Landing from "./components/Landing.tsx";
import { CompareModal, ForwardModal, ReverseModal, SettingsModal, VersionsModal } from "./components/Modals.tsx";
import Setup from "./components/Setup.tsx";
import Workspace from "./components/Workspace.tsx";
import { useStore } from "./store.ts";

function TopBar() {
  const page = useStore((s) => s.page);
  const model = useStore((s) => s.model);
  const dirty = useStore((s) => s.dirty);
  const editing = useStore((s) => s.setupMode === "edit");
  const s = useStore.getState();
  const leave = () => {
    if (page === "workspace" && dirty && !confirm("This model has unsaved changes. Leave without saving?")) return;
    s.go("landing");
  };
  return (
    <header className="top">
      <button className="brand" onClick={leave} title="All models">
        <div className="logo">F</div>forma <span>STUDIO</span>
      </button>
      <div className="crumb">
        {page === "landing" && "AI-first data modeling workspace"}
        {page === "setup" && (editing ? <>Models / <b>{model.name}</b> / Modeling context</> : "Create model / Modeling intent")}
        {page === "workspace" && <><button className="linkbtn" onClick={leave}>Models</button> / <b>{model.name}</b></>}
      </div>
      <div className="spacer" />
      {page === "workspace" && <div className="saved"><span className={"dot" + (dirty ? " dirty" : "")} />{dirty ? "Unsaved changes" : "All changes saved"}</div>}
      <button className="btn ghost" onClick={() => s.openModal("settings")}>⚙ Settings</button>
    </header>
  );
}

export default function App() {
  const page = useStore((s) => s.page);
  const modal = useStore((s) => s.modal);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    const s = useStore.getState();
    s.loadSettings().catch(() => s.notify("The app server is not reachable"));
    // Reopen the model that was open when the page was last closed.
    const last = localStorage.getItem("dm:lastModel");
    if (last && localStorage.getItem("dm:page") === "workspace") api.getModel(last).then((m) => s.load(m)).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || useStore.getState().page !== "workspace") return;
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
      {page === "landing" && <Landing />}
      {page === "setup" && <Setup />}
      {page === "workspace" && <Workspace />}
      {modal === "reverse" && <ReverseModal />}
      {modal === "forward" && <ForwardModal />}
      {modal === "compare" && <CompareModal />}
      {modal === "versions" && <VersionsModal />}
      {modal === "settings" && <SettingsModal />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
