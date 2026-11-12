import { useEffect, useMemo, useState, type ReactNode } from "react";
import { generateDDL } from "../../shared/ddl.ts";
import { describeDiff, diffModels, generateMigration } from "../../shared/diff.ts";
import { DIALECTS, type ConnectionConfig, type DataModel, type Dialect, type VersionInfo } from "../../shared/types.ts";
import { api, download } from "../api.ts";
import { useStore } from "../store.ts";

function Shell({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  const close = () => useStore.getState().openModal(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} title="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function CodeBlock({ code, filename }: { code: string; filename: string }) {
  const notify = useStore((s) => s.notify);
  return (
    <div className="code-wrap">
      <div className="code-actions">
        <button className="btn small" onClick={() => navigator.clipboard.writeText(code).then(() => notify("Copied"))}>Copy</button>
        <button className="btn small" onClick={() => download(filename, code)}>Download</button>
      </div>
      <pre className="code">{code}</pre>
    </div>
  );
}

const DialectSelect = ({ value, onChange, exclude }: { value: string; onChange: (d: Dialect) => void; exclude?: string[] }) => (
  <select className="input" value={value} onChange={(e) => onChange(e.target.value as Dialect)}>
    {DIALECTS.filter((d) => !exclude?.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
  </select>
);

// ------------------------------------------------------------------ Reverse engineering

const PORTS: Record<string, number> = { postgres: 5432, mysql: 3306, sqlserver: 1433 };

export function ReverseModal() {
  const s = useStore.getState();
  const hasTables = useStore((st) => st.model.tables.length > 0);
  const [tab, setTab] = useState<"live" | "sql" | "describe">("live");
  const [cfg, setCfg] = useState<ConnectionConfig>(() => ({ dialect: "postgres", host: "localhost", ...JSON.parse(localStorage.getItem("dm:connection") || "{}") }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DataModel | null>(null);
  const [text, setText] = useState("");
  const set = (patch: Partial<ConnectionConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const run = async (connection: ConnectionConfig) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      // Remember the connection for next time, but never the password.
      const { password: _p, ...rest } = connection;
      if (connection.file !== "sample") localStorage.setItem("dm:connection", JSON.stringify(rest));
      setResult(await api.introspect(connection));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Reverse engineer">
      <div className="tabs">
        <button className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>Live database</button>
        <button className={tab === "sql" ? "on" : ""} onClick={() => setTab("sql")}>SQL script</button>
        <button className={tab === "describe" ? "on" : ""} onClick={() => setTab("describe")}>Description</button>
      </div>

      {tab === "live" && (
        <>
          <div className="form-grid">
            <label className="field"><span>Database type</span><DialectSelect value={cfg.dialect} exclude={["snowflake"]} onChange={(d) => set({ dialect: d as ConnectionConfig["dialect"], port: undefined })} /></label>
            {cfg.dialect === "sqlite" ? (
              <label className="field span2"><span>Database file path</span><input className="input mono" placeholder="/path/to/database.db" value={cfg.file ?? ""} onChange={(e) => set({ file: e.target.value })} /></label>
            ) : (
              <>
                <label className="field"><span>Host</span><input className="input" value={cfg.host ?? ""} onChange={(e) => set({ host: e.target.value })} /></label>
                <label className="field"><span>Port</span><input className="input" type="number" placeholder={String(PORTS[cfg.dialect])} value={cfg.port ?? ""} onChange={(e) => set({ port: e.target.value ? Number(e.target.value) : undefined })} /></label>
                <label className="field"><span>Database</span><input className="input" value={cfg.database ?? ""} onChange={(e) => set({ database: e.target.value })} /></label>
                <label className="field"><span>User</span><input className="input" autoComplete="off" value={cfg.user ?? ""} onChange={(e) => set({ user: e.target.value })} /></label>
                <label className="field"><span>Password</span><input className="input" type="password" autoComplete="off" value={cfg.password ?? ""} onChange={(e) => set({ password: e.target.value })} /></label>
                {cfg.dialect !== "mysql" && <label className="field"><span>Schema (optional)</span><input className="input" placeholder="all schemas" value={cfg.schema ?? ""} onChange={(e) => set({ schema: e.target.value || undefined })} /></label>}
                <label className="check field-check"><input type="checkbox" checked={!!cfg.ssl} onChange={(e) => set({ ssl: e.target.checked })} /> Use SSL</label>
              </>
            )}
          </div>
          <p className="muted small-text">The connection is made from the local app server. Only catalog metadata is read; the password is not stored.</p>
          <div className="form-row">
            <button className="btn primary" disabled={busy} onClick={() => run(cfg)}>{busy ? "Reading schema…" : "Connect and read schema"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => run({ dialect: "sqlite", file: "sample" })}>Try the sample shop database</button>
          </div>
          {error && <p className="error">{error}</p>}
          {result && (
            <div className="result">
              <strong>Found {result.tables.length} tables and {result.relationships.length} foreign keys in “{result.name}”.</strong>
              <div className="form-row">
                <button className="btn primary" onClick={() => (s.load(result, { dirty: true, layout: true }), s.openModal(null))}>Open as new model</button>
                {hasTables && (
                  <button className="btn" onClick={() => (s.setCompareWith({ ...result, name: `Live: ${result.name}` }), s.openModal("compare"))}>
                    Compare with the open model
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab !== "live" && (
        <>
          <p className="muted">
            {tab === "sql"
              ? "Paste CREATE TABLE statements from any database. The copilot reads the script and builds the tables, keys and relationships in the open model."
              : "Describe the system in plain language. The copilot designs the tables, keys and relationships in the open model."}
          </p>
          <textarea
            className="input mono"
            rows={12}
            placeholder={tab === "sql" ? "CREATE TABLE customers (\n  id bigint PRIMARY KEY,\n  ...\n);" : "A clinic booking system with patients, doctors, appointments, and invoices…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="form-row">
            <button
              className="btn primary"
              disabled={!text.trim()}
              onClick={() => {
                s.openModal(null);
                if (tab === "sql") s.askAI("Import the DDL script in the context into this model. Carry over every table, column, primary key, unique constraint, index and foreign key, converting types to this model's dialect where needed.", text);
                else s.askAI(`Design a complete data model for the following and build it in this model:\n\n${text}`);
              }}
            >
              Build with the copilot
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------------ Forward engineering

export function ForwardModal() {
  const model = useStore((s) => s.model);
  const { askAI, openModal } = useStore.getState();
  const [dialect, setDialect] = useState<Dialect>(model.dialect);
  const [dropIfExists, setDrop] = useState(false);
  const [createSchemas, setSchemas] = useState(false);
  const ddl = useMemo(() => generateDDL(model, dialect, { dropIfExists, createSchemas }), [model, dialect, dropIfExists, createSchemas]);
  return (
    <Shell title="Forward engineer" wide>
      <div className="form-row">
        <label className="field inline"><span>Target database</span><DialectSelect value={dialect} onChange={setDialect} /></label>
        <label className="check"><input type="checkbox" checked={dropIfExists} onChange={(e) => setDrop(e.target.checked)} /> DROP IF EXISTS</label>
        <label className="check"><input type="checkbox" checked={createSchemas} onChange={(e) => setSchemas(e.target.checked)} /> CREATE SCHEMA</label>
        <span className="spacer" />
        <button className="btn" onClick={() => (openModal(null), askAI(`Review this generated ${dialect} DDL before I run it. Point out anything that would fail or behave unexpectedly on ${dialect}.`, ddl))}>
          Review with copilot
        </button>
      </div>
      {dialect !== model.dialect && <p className="muted small-text">Column types are translated from {model.dialect} to {dialect}. Types with no known equivalent are passed through unchanged.</p>}
      <CodeBlock code={ddl} filename={`${model.name.replace(/\W+/g, "_")}_${dialect}.sql`} />
    </Shell>
  );
}

// ------------------------------------------------------------------ Compare

export function CompareModal() {
  const current = useStore((s) => s.model);
  const external = useStore((s) => s.compareWith);
  const { askAI, openModal } = useStore.getState();
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [baseKey, setBaseKey] = useState(external ? "external" : "current");
  const [targetKey, setTargetKey] = useState("current");
  const [base, setBase] = useState<DataModel | null>(null);
  const [target, setTarget] = useState<DataModel | null>(null);
  const [dialect, setDialect] = useState<Dialect>(current.dialect);

  useEffect(() => {
    api.listVersions(current.id).then((v) => {
      setVersions(v);
      if (!external && v.length) setBaseKey("v" + v[0].version);
    }).catch(() => {});
  }, [current.id, external]);

  const resolve = async (key: string): Promise<DataModel | null> =>
    key === "current" ? current : key === "external" ? external : api.getVersion(current.id, Number(key.slice(1)));
  useEffect(() => void resolve(baseKey).then(setBase), [baseKey, current, external]);
  useEffect(() => void resolve(targetKey).then(setTarget), [targetKey, current, external]);

  const diff = useMemo(() => (base && target ? diffModels(base, target) : null), [base, target]);
  const script = useMemo(() => (base && target && diff ? generateMigration(base, target, dialect, diff) : ""), [base, target, diff, dialect]);

  const options = (
    <>
      <option value="current">Open model (working copy)</option>
      {external && <option value="external">{external.name}</option>}
      {versions.map((v) => <option key={v.version} value={"v" + v.version}>v{v.version} — {v.message}</option>)}
    </>
  );

  return (
    <Shell title="Compare models" wide>
      <div className="form-row">
        <label className="field inline"><span>From (base)</span><select className="input" value={baseKey} onChange={(e) => setBaseKey(e.target.value)}>{options}</select></label>
        <button className="btn ghost small" title="Swap sides" onClick={() => (setBaseKey(targetKey), setTargetKey(baseKey))}>⇄</button>
        <label className="field inline"><span>To (target)</span><select className="input" value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>{options}</select></label>
      </div>
      {!external && !versions.length && <p className="muted">Nothing to compare against yet. Save a version, or reverse engineer a live database and choose “Compare with the open model”.</p>}
      {diff && (
        <div className="compare">
          <div className="diff">
            <h3>{diff.changeCount ? `${diff.changeCount} difference${diff.changeCount === 1 ? "" : "s"}` : "No differences"}</h3>
            {diff.tablesAdded.map((t) => <div key={t.id} className="d add">+ table <b>{t.name}</b> <span className="muted">{t.columns.length} columns</span></div>)}
            {diff.tablesRemoved.map((t) => <div key={t.id} className="d del">− table <b>{t.name}</b></div>)}
            {diff.tablesChanged.map((t) => (
              <div key={t.name} className="d-group">
                <div className="d chg">~ table <b>{t.name}</b></div>
                {t.columnsAdded.map((c) => <div key={c.id} className="d add sub">+ {c.name} <span className="mono">{c.type}</span></div>)}
                {t.columnsRemoved.map((c) => <div key={c.id} className="d del sub">− {c.name}</div>)}
                {t.columnsChanged.map((c) => <div key={c.name} className="d chg sub">~ {c.name}: {c.changes.join("; ")}</div>)}
                {t.indexesAdded.map((i) => <div key={i.name} className="d add sub">+ index ({i.columns.join(", ")})</div>)}
                {t.indexesRemoved.map((i) => <div key={i.name} className="d del sub">− index ({i.columns.join(", ")})</div>)}
                {t.commentChanged && <div className="d chg sub">~ comment changed</div>}
              </div>
            ))}
            {diff.relationshipsAdded.map((r, i) => <div key={"a" + i} className="d add">+ foreign key {r.fromTable}({r.fromColumns.join(", ")}) → {r.toTable}({r.toColumns.join(", ")})</div>)}
            {diff.relationshipsRemoved.map((r, i) => <div key={"r" + i} className="d del">− foreign key {r.fromTable}({r.fromColumns.join(", ")}) → {r.toTable}({r.toColumns.join(", ")})</div>)}
          </div>
          <div className="script">
            <div className="form-row">
              <h3>Migration script</h3>
              <span className="spacer" />
              <DialectSelect value={dialect} onChange={setDialect} />
              <button
                className="btn"
                disabled={!diff.changeCount}
                onClick={() => (openModal(null), askAI("Assess this migration. Which statements can lose data, fail on existing rows, or lock large tables? Suggest a safer order or extra steps where needed.", `Differences (base → target):\n${describeDiff(diff)}\n\nGenerated ${dialect} migration script:\n${script}`))}
              >
                Assess with copilot
              </button>
            </div>
            <CodeBlock code={script} filename={`migration_${dialect}.sql`} />
          </div>
        </div>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------------ Versions

export function VersionsModal() {
  const model = useStore((s) => s.model);
  const dirty = useStore((s) => s.dirty);
  const s = useStore.getState();
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [message, setMessage] = useState("");
  const refresh = () => api.listVersions(model.id).then(setVersions).catch(() => setVersions([]));
  useEffect(() => void refresh(), [model.id]);

  const commit = async () => {
    const v = await api.createVersion(useStore.getState().model, message);
    useStore.setState({ dirty: false });
    localStorage.setItem("dm:lastModel", model.id);
    setMessage("");
    s.notify(`Saved version ${v.version}`);
    refresh();
  };

  return (
    <Shell title="Versions">
      <p className="muted">A version is an immutable JSON snapshot of the model. Compare any two versions, generate the migration between them, or restore one.</p>
      <div className="form-row">
        <input className="input" placeholder="What changed in this version?" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} />
        <button className="btn primary" onClick={commit}>Save version {versions.length ? versions[0].version + 1 : 1}</button>
      </div>
      {dirty && <p className="muted small-text">The open model has unsaved changes; saving a version also saves the model.</p>}
      <div className="form-row">
        <button className="btn" onClick={() => download(`${model.name}.model.json`, JSON.stringify(useStore.getState().model, null, 2), "application/json")}>Export working copy as JSON</button>
      </div>
      <div className="list">
        {versions.map((v) => (
          <div className="list-row" key={v.version}>
            <div>
              <strong>v{v.version}</strong> {v.message}
              <div className="muted small-text">{new Date(v.createdAt).toLocaleString()} · {v.tableCount} tables</div>
            </div>
            <div>
              <button className="btn small" onClick={async () => (s.setCompareWith({ ...(await api.getVersion(model.id, v.version)), name: `v${v.version} — ${v.message}` }), s.openModal("compare"))}>Compare</button>
              <button className="btn small" onClick={async () => { const m = await api.getVersion(model.id, v.version); s.update(() => m, { fit: true }); s.notify(`Restored v${v.version} into the working copy (undo to revert)`); s.openModal(null); }}>Restore</button>
              <button className="btn small ghost" onClick={async () => download(`${model.name}.v${v.version}.json`, JSON.stringify(await api.getVersion(model.id, v.version), null, 2), "application/json")}>JSON</button>
            </div>
          </div>
        ))}
        {!versions.length && <p className="muted">No versions yet.</p>}
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ Settings

export function SettingsModal() {
  const settings = useStore((s) => s.settings);
  const { notify, openModal } = useStore.getState();
  const [providerId, setProviderId] = useState(settings?.provider ?? "anthropic");
  const p = settings?.providers.find((x) => x.id === providerId);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(p?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(p?.baseUrl ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each provider keeps its own key, model and URL; show that provider's values when switching.
  useEffect(() => {
    setApiKey("");
    setModels([]);
    setError("");
    setModel(p?.model ?? "");
    setBaseUrl(p?.baseUrl ?? "");
  }, [providerId]);

  if (!settings || !p) return <Shell title="Settings"><p className="muted">The app server is not reachable.</p></Shell>;
  const custom = p.id === "custom";

  const save = async (extra: { clearApiKey?: boolean } = {}) => {
    const next = await api.saveSettings({ provider: providerId, apiKey: apiKey || undefined, model, ...(custom ? { baseUrl } : {}), ...extra });
    useStore.setState({ settings: next });
    setApiKey("");
    return next;
  };
  const loadModels = async () => {
    setBusy(true);
    setError("");
    try {
      await save();
      const list = await api.listProviderModels(providerId);
      setModels(list);
      notify(list.length ? `${list.length} models available — pick one from the list` : "The provider returned no models");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Settings">
      <h3>Modeling Copilot</h3>
      <label className="field">
        <span>AI provider</span>
        <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          {settings.providers.map((x) => <option key={x.id} value={x.id}>{x.label}{x.ready ? " — configured" : ""}</option>)}
        </select>
      </label>
      {custom && (
        <label className="field">
          <span>Base URL</span>
          <input className="input mono" placeholder="http://localhost:11434/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>API key{custom ? " (optional)" : ""}</span>
        <input className="input mono" type="password" autoComplete="off" placeholder={p.hasKey ? `Key set (${p.keyHint}) — enter a new one to replace it` : "Paste your key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </label>
      <p className="muted small-text">
        {p.keyHelp}.{" "}
        {p.keySource === "env"
          ? `Currently using the ${p.env} environment variable of the app server.`
          : "Keys are stored in data/settings.json on this machine, sent only to the provider you select, and never returned to the browser."}
      </p>
      <label className="field">
        <span>Model</span>
        <div className="form-row">
          <input className="input mono" list="provider-models" placeholder={p.defaultModel || "model id"} value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="provider-models">{[...new Set([p.defaultModel, ...models].filter(Boolean))].map((m) => <option key={m} value={m} />)}</datalist>
          <button className="btn" disabled={busy} onClick={loadModels}>{busy ? "Loading…" : "Load available models"}</button>
        </div>
      </label>
      {models.length > 0 && (
        <div className="chips">
          {models.slice(0, 40).map((m) => <button key={m} className={"chip" + (m === model ? " on" : "")} onClick={() => setModel(m)}>{m}</button>)}
        </div>
      )}
      <p className="muted small-text">The copilot edits the model through tool calls, so pick a model that supports function calling. Larger models follow the modeling context more reliably.</p>
      {error && <p className="error">{error}</p>}
      <div className="form-row">
        <button className="btn primary" onClick={async () => { const next = await save(); notify(`Copilot now uses ${next.providerLabel}`); openModal(null); }}>Save and use {p.label}</button>
        {p.keySource === "settings" && <button className="btn ghost danger" onClick={() => save({ clearApiKey: true }).then(() => notify("Stored key removed"))}>Remove stored key</button>}
      </div>
    </Shell>
  );
}
