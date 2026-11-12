import { useEffect, useState } from "react";
import { sampleModel } from "../../shared/sample.ts";
import { uid, type DataModel, type ModelSummary } from "../../shared/types.ts";
import { api } from "../api.ts";
import { layoutModel, useStore } from "../store.ts";

export default function Landing() {
  const s = useStore.getState();
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const refresh = () => api.listModels().then(setModels).catch(() => setModels([]));
  useEffect(() => void refresh(), []);

  const open = async (id: string) => s.load(await api.getModel(id));
  const importFile = async (file: File) => {
    try {
      const m = JSON.parse(await file.text()) as DataModel;
      if (!Array.isArray(m.tables) || !Array.isArray(m.relationships)) throw new Error("not a Forma model file");
      s.load({ ...m, id: uid("m_") }, { dirty: true });
    } catch (e) {
      s.notify("Import failed: " + (e as Error).message);
    }
  };

  return (
    <section className="page">
      <div className="wrap">
        <div className="hero">
          <div>
            <div className="eyebrow">AI-first data modeling</div>
            <h1>Design better data models. With intelligence built in.</h1>
            <p>
              Explore, design and govern data models on a visual canvas, with a copilot that understands your business domain, modeling
              methodology and target platform.
            </p>
            <div className="hero-actions">
              <button className="btn primary" onClick={() => s.go("setup", "create")}>＋ Create a model</button>
              <button className="btn" onClick={() => s.load(layoutModel(sampleModel()), { dirty: true })}>Explore sample model ↗</button>
              <button className="btn" onClick={() => s.openModal("reverse")}>Reverse engineer a database</button>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-top"><b>FINANCE ANALYTICS MODEL</b><span>✧ AI assisted</span></div>
            <div className="art-canvas">
              <div className="mini-table m1"><b>DIM_CUSTOMER</b><span>PK customer_key</span><span>customer_name</span><span>customer_segment</span></div>
              <div className="mini-table m2"><b>FACT_INVOICE <i>FACT</i></b><span>PK invoice_line_key</span><span>FK customer_key</span><span>invoice_amount</span></div>
              <div className="mini-table m3"><b>DIM_DATE</b><span>PK date_key</span><span>calendar_month</span><span>fiscal_year</span></div>
              <div className="art-ai"><b>✧ Modeling Copilot</b><p>Fact grain appears to be invoice line. Consider conformed Customer and Date dimensions.</p></div>
            </div>
          </div>
        </div>

        <div className="features">
          <div className="feature"><div className="ico">✧</div><b>Intent-aware AI</b><p>Recommendations adapt to Star Schema, 3NF, Data Vault and your business context.</p></div>
          <div className="feature"><div className="ico">▦</div><b>Visual model studio</b><p>Explore entities, relationships, subject areas and metadata on a professional canvas.</p></div>
          <div className="feature"><div className="ico">✓</div><b>Human-governed changes</b><p>Review AI proposals and approve them before they are applied to your model.</p></div>
        </div>

        <div className="section-head">
          <div>
            <h2>Your models</h2>
            <p>Continue working, or start a new model with guided setup.</p>
          </div>
          <label className="btn">
            Import model JSON
            <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </label>
        </div>
        <div className="model-cards">
          {models?.map((m) => (
            <div className="model-card" key={m.id} role="button" tabIndex={0} onClick={() => open(m.id)} onKeyDown={(e) => e.key === "Enter" && open(m.id)}>
              <button
                className="icon-btn card-x"
                title="Delete model"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${m.name}" and all its versions?`)) api.deleteModel(m.id).then(refresh);
                }}
              >
                ×
              </button>
              <div className="mc-icon">▦</div>
              <b>{m.name}</b>
              <p>{m.subtitle}</p>
              <small>{m.tableCount} tables · {m.latestVersion ? `v${m.latestVersion}` : "no versions"} · updated {new Date(m.updatedAt).toLocaleDateString()}</small>
            </div>
          ))}
          <div className="model-card new" role="button" tabIndex={0} onClick={() => s.go("setup", "create")} onKeyDown={(e) => e.key === "Enter" && s.go("setup", "create")}>
            <div className="mc-icon">＋</div>
            <b>New model</b>
            <p>Guided setup: methodology, domain, platform and guardrails.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
