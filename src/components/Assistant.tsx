import { useEffect, useRef, useState, type ReactNode } from "react";
import { pattern } from "../../shared/intent.ts";
import { useStore } from "../store.ts";

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

/** Small markdown subset: fenced code, headings, bullet/numbered lists, bold, inline code. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  text.split(/```/).forEach((part, i) => {
    if (i % 2) {
      out.push(<pre key={i}><code>{part.replace(/^[a-z]*\n/, "")}</code></pre>);
      return;
    }
    let list: ReactNode[] = [];
    const flush = (k: string) => list.length && (out.push(<ul key={k}>{list}</ul>), (list = []));
    part.split("\n").forEach((line, j) => {
      const key = `${i}-${j}`;
      const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
      const h = line.match(/^#{1,4}\s+(.*)/);
      if (li) list.push(<li key={key}>{inline(li[1])}</li>);
      else {
        flush(key + "l");
        if (h) out.push(<h4 key={key}>{inline(h[1])}</h4>);
        else if (line.trim()) out.push(<p key={key}>{inline(line)}</p>);
      }
    });
    flush(i + "end");
  });
  return <>{out}</>;
}

const PROMPTS: Record<string, string> = {
  "Review fact grain": "Review every fact table against the declared grain. Is each measure valid at that grain, and can any join duplicate rows? List review candidates; do not change anything yet.",
  "Check SCD strategy": "Check the dimensions against the declared history strategy. Which dimensions need history columns, and are current-row and surrogate-key handling in place? Do not change anything yet.",
  "Find design issues": "Find design issues in this model under its declared methodology and guardrails. List them by severity as review candidates; do not change anything yet.",
};

export default function Copilot() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.chatBusy);
  const settings = useStore((s) => s.settings);
  const intent = useStore((s) => s.model.intent);
  const empty = useStore((s) => s.model.tables.length === 0);
  const selected = useStore((s) => s.model.tables.find((t) => t.id === s.selectedTableId)?.name);
  const { askAI, stopAI, clearChat, openModal, applyProposal, discardProposal } = useStore.getState();
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [chat]);

  const send = (text = draft) => {
    if (!text.trim() || busy) return;
    askAI(PROMPTS[text] ?? text.trim());
    setDraft("");
  };
  const p = intent && pattern(intent.pattern);
  const suggestions = empty ? ["Draft a starter model from my context"] : p?.suggestions ?? ["Review this model", "Suggest indexes", "Explain this model"];
  const hasKey = settings?.hasApiKey;

  return (
    <div className="copilot">
      <div className="copilot-head">
        <span>✧ Modeling Copilot</span>
        <span className="copilot-meta">
          {hasKey === false ? "No API key" : `${settings?.providerLabel.split(" (")[0]} · ${intent ? "intent connected" : "no context set"}`}
          {chat.length > 0 && <button className="linkbtn" onClick={clearChat} disabled={busy}>New chat</button>}
        </span>
      </div>
      <div className="messages" ref={scroller}>
        {hasKey === false && (
          <div className="msg warn">
            Add an API key for your AI provider to turn the copilot on. <button className="linkbtn" onClick={() => openModal("settings")}>Open settings</button>
          </div>
        )}
        {!chat.length && (
          <div className="msg bot">
            {intent && p
              ? `I understand this is a ${intent.domain} ${p.name} for ${intent.purpose}. I'll tailor guidance to your declared context${intent.guardrails.approval ? ", and any change I propose waits for your approval" : ""}.`
              : "Ask about this model or describe a change. Set up the modeling context so I can judge the design by your methodology."}
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={"msg " + (m.role === "user" ? "user" : "bot")}>
            {m.role === "user" ? m.text : <Markdown text={m.text} />}
            {m.ops && <ul className="ops">{m.ops.map((o, i) => <li key={i} className={o.ok ? "ok" : "fail"}>{o.message}</li>)}</ul>}
            {m.proposal === "pending" && (
              <div className="proposal">
                <span>Proposed changes — not applied yet</span>
                <button className="smallbtn primary" onClick={applyProposal} disabled={busy}>Apply changes</button>
                <button className="smallbtn" onClick={discardProposal} disabled={busy}>Discard</button>
              </div>
            )}
            {m.proposal && m.proposal !== "pending" && (
              <div className={"proposal done " + m.proposal}>
                {m.proposal === "applied" ? "✓ Applied to the model" : m.proposal === "discarded" ? "Discarded" : "Included in the later proposal"}
              </div>
            )}
            {m.status && <p className="status">{m.status}</p>}
            {m.error && <p className="error">{m.error}</p>}
          </div>
        ))}
        {!busy && (
          <div className="suggest">
            {suggestions.map((x) => (
              <button key={x} onClick={() => send(x === "Draft a starter model from my context" ? "Draft a starter model that fits the declared modeling context: the core tables, keys and relationships for this domain and workload, organised into subject areas." : x)}>{x}</button>
            ))}
          </div>
        )}
      </div>
      {selected && <div className="chat-context">Context: <b>{selected}</b> is selected</div>}
      <div className="chatinput">
        <textarea
          rows={1}
          placeholder="Ask about this model, or describe a change…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? <button onClick={stopAI} title="Stop">■</button> : <button onClick={() => send()} disabled={!draft.trim()} title="Send">↑</button>}
      </div>
    </div>
  );
}
