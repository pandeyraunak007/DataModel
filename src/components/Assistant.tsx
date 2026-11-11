import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store.ts";

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

/** Small markdown subset: fenced code, headings, bullet/numbered lists, bold, inline code. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, i) => {
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

const STARTERS = [
  { label: "Design a model from a description", prompt: "", fill: "Design a data model for " },
  { label: "Review this model", prompt: "Review this model for design problems: missing keys, wrong types, missing foreign keys or indexes, naming inconsistencies, normalization issues. List findings by severity; do not change anything yet." },
  { label: "Suggest indexes", prompt: "Suggest the indexes this model needs (foreign key columns and likely lookup columns). List them with one-line reasons, then ask whether to add them." },
  { label: "Explain this model", prompt: "Explain what this model represents, table by table, and how the tables relate." },
  { label: "Write sample queries", prompt: "Write five useful example SQL queries against this model, in its dialect, each with a one-line description." },
];

export default function Assistant() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.chatBusy);
  const settings = useStore((s) => s.settings);
  const { askAI, stopAI, clearChat, toggleAssistant, openModal } = useStore.getState();
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [chat]);

  const send = () => {
    if (!draft.trim() || busy) return;
    askAI(draft.trim());
    setDraft("");
  };

  return (
    <aside className="assistant">
      <div className="side-head">
        <h2>Assistant</h2>
        <div>
          {chat.length > 0 && <button className="btn ghost small" onClick={clearChat} disabled={busy}>New chat</button>}
          <button className="icon-btn" title="Hide assistant" onClick={() => toggleAssistant(false)}>×</button>
        </div>
      </div>

      {settings && !settings.hasApiKey && (
        <div className="notice">
          Add your Anthropic API key to turn the assistant on.
          <button className="btn small" onClick={() => openModal("settings")}>Open settings</button>
        </div>
      )}

      <div className="chat" ref={scroller}>
        {!chat.length && (
          <div className="starters">
            <p className="muted">Ask for anything in plain language. The assistant sees the open model and can edit it for you; every change it makes can be undone.</p>
            {STARTERS.map((s) => (
              <button
                key={s.label}
                className="starter"
                onClick={() => {
                  if (s.fill) {
                    setDraft(s.fill);
                    input.current?.focus();
                  } else askAI(s.prompt);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={"msg " + m.role}>
            {m.role === "user" ? <p>{m.text}</p> : <Markdown text={m.text} />}
            {m.ops && (
              <ul className="ops">
                {m.ops.map((o, i) => <li key={i} className={o.ok ? "ok" : "fail"}>{o.message}</li>)}
              </ul>
            )}
            {m.status && <p className="status">{m.status}</p>}
            {m.error && <p className="error">{m.error}</p>}
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          ref={input}
          className="input"
          rows={3}
          placeholder="Ask, or describe a change to the model…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? <button className="btn" onClick={stopAI}>Stop</button> : <button className="btn primary" onClick={send} disabled={!draft.trim()}>Send</button>}
      </div>
    </aside>
  );
}
