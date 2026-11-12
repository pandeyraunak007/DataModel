import { useState } from "react";
import { defaultIntent, DOMAINS, MODEL_TYPES, NAMING, pattern, PATTERNS, PK_STRATEGIES, PURPOSES } from "../../shared/intent.ts";
import { DIALECTS, emptyModel, type Dialect, type ModelIntent, type Pattern } from "../../shared/types.ts";
import { useStore } from "../store.ts";

const GUARDRAILS: [keyof ModelIntent["guardrails"], string, string][] = [
  ["patternRules", "Validate against selected modeling pattern", "Use methodology-specific rules before generic design heuristics."],
  ["denorm", "Respect intentional denormalization", "Do not flag pattern-appropriate redundancy as a defect."],
  ["platformRules", "Include target-platform recommendations", "Consider platform-specific types and physical design."],
  ["approval", "Require approval for AI changes", "The copilot proposes changes; you approve before they are applied."],
];

const Select = ({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => <option key={o}>{o}</option>)}
  </select>
);

export default function Setup() {
  const s = useStore.getState();
  const editing = useStore((st) => st.setupMode === "edit");
  const current = useStore((st) => st.model);
  const [step, setStep] = useState<"intent" | "review">("intent");
  const [name, setName] = useState(editing ? current.name : "");
  const [description, setDescription] = useState(editing ? current.description ?? "" : "");
  const [dialect, setDialect] = useState<Dialect>(editing ? current.dialect : "snowflake");
  const [intent, setIntent] = useState<ModelIntent>(editing && current.intent ? current.intent : defaultIntent());
  const p = pattern(intent.pattern);
  const patch = (x: Partial<ModelIntent>) => setIntent((i) => ({ ...i, ...x }));
  const platform = DIALECTS.find((d) => d.id === dialect)!.label;
  const modelName = name.trim() || "Untitled model";

  const choosePattern = (id: Pattern) =>
    patch({ pattern: id, details: Object.fromEntries(pattern(id).fields.map((f) => [f.key, f.options ? f.default : intent.details[f.key] ?? ""])) });

  const finish = () => {
    if (editing) {
      s.update((m) => ({ ...m, name: modelName, description: description || undefined, dialect, intent }));
      s.go("workspace");
      s.notify("Modeling context updated");
    } else {
      s.load({ ...emptyModel(modelName, dialect), description: description || undefined, intent }, { dirty: true });
      s.notify("Model created · modeling context connected");
    }
  };

  const rows: [string, string][] = [
    ["Pattern", p.name],
    ["Business domain", intent.domain],
    ["Workload", intent.purpose],
    ["Target platform", platform],
    ...p.fields.map((f) => [f.label, intent.details[f.key] || "Not specified"] as [string, string]),
  ];

  const stepper = (
    <div className="stepper">
      <div className="step done"><span className="circle">✓</span> {editing ? "Model" : "Create model"}</div>
      <div className="step-line" />
      <div className={"step " + (step === "intent" ? "active" : "done")}><span className="circle">{step === "intent" ? 2 : "✓"}</span> Modeling intent</div>
      <div className="step-line" />
      <div className={"step " + (step === "review" ? "active" : "")}><span className="circle">3</span> Review profile</div>
      <div className="step-line" />
      <div className="step"><span className="circle">4</span> Open model</div>
    </div>
  );

  if (step === "review")
    return (
      <section className="page" key="review">
        <div className="wrap">
          <div className="wizard-head">
            <div>
              <div className="eyebrow">Final setup · review</div>
              <h1>{editing ? "Review the updated context" : "Your model is ready to be created"}</h1>
              <p>This is the modeling context Forma uses to personalize recommendations and validation. You can change it at any time.</p>
            </div>
          </div>
          {stepper}
          <div className="layout">
            <div className="content-card">
              <div className="cardhead"><h2>{modelName}</h2><p>Model configuration and AI context summary.</p></div>
              <div className="cardbody">
                {[["Model type", intent.modelType], ["Workspace / project", intent.project || "Not specified"], ...rows, ["Naming convention", intent.naming], ["Primary key strategy", intent.pkStrategy]].map(([k, v]) => (
                  <div className="profile-row" key={k}><span>{k}</span><span>{v}</span></div>
                ))}
                <div className="divider" />
                <div className="section-label">AI behavior enabled</div>
                <div className="rules">
                  {GUARDRAILS.map(([k, label]) => <div key={k} className={intent.guardrails[k] ? "on" : "off"}>{intent.guardrails[k] ? "✓" : "–"} {label}</div>)}
                </div>
              </div>
            </div>
            <div className="ai-card">
              <div className="ai-title">✧ Initial recommendation preview</div>
              <p>{p.lens} Recommendations will also consider {intent.domain} domain conventions and {platform} platform capabilities.</p>
              <div className="ai-mini"><b>Important</b><span>AI recommendations are contextual suggestions. {intent.guardrails.approval ? "Structural changes wait for your approval before they are applied." : "With approval turned off, the copilot applies changes directly; every change can be undone."}</span></div>
            </div>
          </div>
          <div className="foot-actions">
            <button className="btn" onClick={() => setStep("intent")}>← Edit intent</button>
            <button className="btn primary" onClick={finish}>{editing ? "Save context & return to model →" : "Create model & open workspace →"}</button>
          </div>
        </div>
      </section>
    );

  return (
    <section className="page" key="intent">
      <div className="wrap">
        <div className="wizard-head">
          <div>
            <div className="eyebrow">{editing ? "Modeling context" : "New model · guided setup"}</div>
            <h1>Set up your modeling context</h1>
            <p>Tell Forma what you're building. This context shapes every AI recommendation, validation and modeling action that follows.</p>
          </div>
          <button className="btn" onClick={() => s.go(editing ? "workspace" : "landing")}>Cancel</button>
        </div>
        {stepper}
        <div className="layout">
          <div>
            <section className="content-card">
              <div className="cardhead"><h2>Model details</h2><p>Name your model and describe the business problem it will solve.</p></div>
              <div className="cardbody">
                <div className="fieldgrid">
                  <div className="field"><label>Model name</label><input value={name} placeholder="Finance Analytics Model" onChange={(e) => setName(e.target.value)} /></div>
                  <div className="field"><label>Workspace / project</label><input value={intent.project} placeholder="Enterprise Data Platform" onChange={(e) => patch({ project: e.target.value })} /></div>
                  <div className="field"><label>Model type</label><Select value={intent.modelType} options={MODEL_TYPES} onChange={(v) => patch({ modelType: v })} /></div>
                  <div className="field">
                    <label>Target data platform</label>
                    <select value={dialect} onChange={(e) => setDialect(e.target.value as Dialect)}>
                      {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="field full"><label>Business description</label><textarea value={description} placeholder="What will this model support?" onChange={(e) => setDescription(e.target.value)} /></div>
                </div>
              </div>
            </section>

            <section className="content-card">
              <div className="cardhead"><h2>What are you designing?</h2><p>Select a modeling methodology. Forma adapts its design checks and AI recommendations accordingly.</p></div>
              <div className="cardbody">
                <div className="pattern-grid">
                  {PATTERNS.map((x) => (
                    <button key={x.id} className={"choice" + (x.id === intent.pattern ? " selected" : "")} onClick={() => choosePattern(x.id)}>
                      <span className="check">✓</span>
                      <div className="symbol">{x.symbol}</div>
                      <strong>{x.name}</strong>
                      <small>{x.blurb}</small>
                    </button>
                  ))}
                </div>
                <div className="divider" />
                <div className="section-label">Business domain</div>
                <div className="fieldgrid">
                  <div className="field"><label>Industry / domain</label><Select value={intent.domain} options={DOMAINS} onChange={(v) => patch({ domain: v })} /></div>
                  <div className="field"><label>Primary workload</label><Select value={intent.purpose} options={PURPOSES} onChange={(v) => patch({ purpose: v })} /></div>
                  {p.fields.map((f) => (
                    <div className="field" key={intent.pattern + f.key}>
                      <label>{f.label}</label>
                      {f.options ? (
                        <Select value={intent.details[f.key] || f.default} options={f.options} onChange={(v) => patch({ details: { ...intent.details, [f.key]: v } })} />
                      ) : (
                        <input value={intent.details[f.key] ?? ""} placeholder={f.key === "grain" && intent.pattern === "STAR_SCHEMA" ? "e.g. One row per invoice line" : ""} onChange={(e) => patch({ details: { ...intent.details, [f.key]: e.target.value } })} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="content-card">
              <div className="cardhead"><h2>Modeling standards and guardrails</h2><p>The rules the copilot and validation respect. You can refine these later.</p></div>
              <div className="cardbody">
                <div className="fieldgrid">
                  <div className="field"><label>Naming convention</label><Select value={intent.naming} options={NAMING} onChange={(v) => patch({ naming: v })} /></div>
                  <div className="field"><label>Primary key strategy</label><Select value={intent.pkStrategy} options={PK_STRATEGIES} onChange={(v) => patch({ pkStrategy: v })} /></div>
                </div>
                <div className="divider" />
                {GUARDRAILS.map(([k, label, hint]) => (
                  <label className="toggleline" key={k}>
                    <div><strong>{label}</strong><small>{hint}</small></div>
                    <input className="switch" type="checkbox" checked={intent.guardrails[k]} onChange={(e) => patch({ guardrails: { ...intent.guardrails, [k]: e.target.checked } })} />
                  </label>
                ))}
              </div>
            </section>
          </div>

          <aside className="side-stack">
            <div className="content-card profile-card">
              <div className="profile-top"><b>Live intent profile</b><span className="badge">{editing ? "Editing" : "Draft"}</span></div>
              <div className="profile-name">{intent.domain} · {p.name}</div>
              <div className="profile-desc">The context supplied to the copilot and to validation for this model.</div>
              <div className="profile-rows">{rows.slice(0, 6).map(([k, v]) => <div className="profile-row" key={k}><span>{k}</span><span>{v}</span></div>)}</div>
            </div>
            <div className="ai-card">
              <div className="ai-title">✧ How AI will adapt</div>
              <p>{p.explain}</p>
              <div className="ai-mini"><b>Example recommendation lens</b><span>{p.lens}</span></div>
            </div>
            <div className="content-card profile-card">
              <b>Context is not a one-time lock</b>
              <p className="profile-desc">Update the profile at any time from the workspace. Validation and the copilot pick up the change immediately.</p>
            </div>
          </aside>
        </div>
        <div className="foot-actions">
          <div className="hint">Everything here can be changed later. Leave optional fields blank if you have not decided yet.</div>
          <div className="btn-row">
            <button className="btn" onClick={() => s.go(editing ? "workspace" : "landing")}>Back</button>
            <button className="btn primary" onClick={() => setStep("review")}>Review intent{editing ? "" : " & create model"} →</button>
          </div>
        </div>
      </div>
    </section>
  );
}
