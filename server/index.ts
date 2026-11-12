import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DataModel } from "../shared/types.ts";
import { chat, listModels } from "./ai.ts";
import { ensureSampleDb, introspect, SAMPLE_DB } from "./introspect.ts";
import { provider, PROVIDERS } from "./providers.ts";
import * as store from "./store.ts";

const app = express();
app.use(express.json({ limit: "20mb" }));

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);
const id = (req: Request) => String(req.params.id);

// ---- models ----
app.get("/api/models", wrap((_req, res) => res.json(store.listModels())));
app.get("/api/models/:id", wrap((req, res) => {
  const m = store.getModel(id(req));
  return m ? res.json(m) : res.status(404).json({ error: "Model not found" });
}));
app.put("/api/models/:id", wrap((req, res) => {
  const model = req.body as DataModel;
  if (!model?.id || model.id !== id(req) || !Array.isArray(model.tables)) return res.status(400).json({ error: "Invalid model" });
  res.json(store.saveModel(model));
}));
app.delete("/api/models/:id", wrap((req, res) => {
  store.deleteModel(id(req));
  res.json({ ok: true });
}));

// ---- versions ----
app.get("/api/models/:id/versions", wrap((req, res) => res.json(store.listVersions(id(req)))));
app.post("/api/models/:id/versions", wrap((req, res) => {
  const { model, message } = req.body as { model: DataModel; message: string };
  if (!model?.id || model.id !== id(req)) return res.status(400).json({ error: "Invalid model" });
  res.json(store.createVersion(model, (message || "").trim() || "Untitled version"));
}));
app.get("/api/models/:id/versions/:version", wrap((req, res) => {
  const m = store.getVersion(id(req), Number(req.params.version));
  return m ? res.json(m) : res.status(404).json({ error: "Version not found" });
}));

// ---- reverse engineering ----
app.post("/api/db/introspect", wrap(async (req, res) => {
  const cfg = req.body?.connection;
  if (!cfg?.dialect) return res.status(400).json({ error: "Missing connection" });
  if (cfg.dialect === "sqlite" && cfg.file === "sample") cfg.file = SAMPLE_DB;
  try {
    res.json(await introspect(cfg));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message || String(e) });
  }
}));

// ---- settings ----
const settingsView = () => {
  const active = store.resolveProvider();
  const ready = (r: ReturnType<typeof store.resolveProvider>) => (r.info.id === "custom" ? !!r.baseUrl : !!r.key);
  return {
    provider: active.info.id,
    providerLabel: active.info.label,
    hasApiKey: ready(active),
    providers: PROVIDERS.map((p) => {
      const r = store.resolveProvider(p.id);
      return {
        id: p.id, label: p.label, keyHelp: p.keyHelp, env: p.env, defaultModel: p.defaultModel,
        hasKey: !!r.key, ready: ready(r), keySource: r.keySource, keyHint: r.key ? "…" + r.key.slice(-4) : "", model: r.model, baseUrl: r.baseUrl,
      };
    }),
  };
};
app.get("/api/settings", wrap((_req, res) => res.json(settingsView())));
app.put("/api/settings", wrap((req, res) => {
  const b = req.body as { provider?: string; apiKey?: string; model?: string; baseUrl?: string; clearApiKey?: boolean };
  const s = store.readSettings();
  const id = provider(b.provider ?? s.provider).id;
  s.provider = id;
  s.keys = { ...s.keys };
  s.models = { ...s.models };
  if (typeof b.apiKey === "string" && b.apiKey.trim()) s.keys[id] = b.apiKey.trim();
  if (b.clearApiKey) delete s.keys[id];
  if (typeof b.model === "string") b.model.trim() ? (s.models[id] = b.model.trim()) : delete s.models[id];
  if (id === "custom" && typeof b.baseUrl === "string") s.baseUrl = b.baseUrl.trim();
  store.writeSettings(s);
  res.json(settingsView());
}));
app.get("/api/settings/models", wrap(async (req, res) => {
  try {
    res.json(await listModels(String(req.query.provider || "")));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
}));

// ---- AI ----
app.post("/api/ai/chat", (req, res) => void chat(req.body, res));

// ---- static (production build) ----
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

ensureSampleDb();
const port = Number(process.env.API_PORT) || 4177;
// Bound to loopback only: this server holds an API key and opens database connections.
app.listen(port, "127.0.0.1", () => console.log(`DataModel Studio API on http://127.0.0.1:${port}`));
