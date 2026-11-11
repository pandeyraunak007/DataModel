import type { ConnectionConfig, DataModel, ModelSummary, VersionInfo } from "../shared/types.ts";
import type { OpResult } from "../shared/ops.ts";

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export interface SettingsView {
  hasApiKey: boolean;
  keySource: "settings" | "env" | "none";
  keyHint: string;
  aiModel: string;
}

export const api = {
  listModels: () => http<ModelSummary[]>("/api/models"),
  getModel: (id: string) => http<DataModel>(`/api/models/${id}`),
  saveModel: (m: DataModel) => http<DataModel>(`/api/models/${m.id}`, json("PUT", m)),
  deleteModel: (id: string) => http<{ ok: true }>(`/api/models/${id}`, { method: "DELETE" }),
  listVersions: (id: string) => http<VersionInfo[]>(`/api/models/${id}/versions`),
  createVersion: (m: DataModel, message: string) => http<VersionInfo>(`/api/models/${m.id}/versions`, json("POST", { model: m, message })),
  getVersion: (id: string, v: number) => http<DataModel>(`/api/models/${id}/versions/${v}`),
  introspect: (connection: ConnectionConfig) => http<DataModel>("/api/db/introspect", json("POST", { connection })),
  getSettings: () => http<SettingsView>("/api/settings"),
  saveSettings: (s: { apiKey?: string; aiModel?: string; clearApiKey?: boolean }) => http<SettingsView>("/api/settings", json("PUT", s)),
};

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "status"; message: string }
  | { type: "ops"; results: OpResult[] }
  | { type: "model"; model: DataModel }
  | { type: "error"; message: string }
  | { type: "done"; changed: boolean };

export async function streamChat(
  body: { model: DataModel; history: { role: "user" | "assistant"; text: string }[]; message: string; context?: string },
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw new Error(`Assistant request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

export function download(filename: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
