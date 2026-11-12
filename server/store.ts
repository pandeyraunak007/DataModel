// File-based storage: every model is a JSON file, every version an immutable JSON snapshot.
//   data/models/<id>/model.json
//   data/models/<id>/versions/0001.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelSubtitle } from "../shared/intent.ts";
import type { DataModel, ModelSummary, VersionInfo } from "../shared/types.ts";
import { provider, type ProviderId } from "./providers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, "..", "data");
const MODELS_DIR = path.join(DATA_DIR, "models");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
fs.mkdirSync(MODELS_DIR, { recursive: true });

function dirFor(id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid model id");
  return path.join(MODELS_DIR, id);
}
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file: string, value: unknown, mode?: number) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", mode ? { mode } : undefined);

function versionFiles(id: string): string[] {
  const dir = path.join(dirFor(id), "versions");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort() : [];
}

export function listModels(): ModelSummary[] {
  return fs
    .readdirSync(MODELS_DIR)
    .filter((id) => fs.existsSync(path.join(MODELS_DIR, id, "model.json")))
    .map((id) => {
      const m = readJson<DataModel>(path.join(MODELS_DIR, id, "model.json"));
      const v = versionFiles(id);
      return {
        id: m.id,
        name: m.name,
        dialect: m.dialect,
        subtitle: modelSubtitle(m),
        tableCount: m.tables.length,
        updatedAt: m.updatedAt,
        latestVersion: v.length ? parseInt(v[v.length - 1], 10) : 0,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getModel(id: string): DataModel | null {
  const file = path.join(dirFor(id), "model.json");
  return fs.existsSync(file) ? readJson<DataModel>(file) : null;
}

export function saveModel(model: DataModel): DataModel {
  const dir = dirFor(model.id);
  fs.mkdirSync(dir, { recursive: true });
  const saved = { ...model, updatedAt: new Date().toISOString() };
  writeJson(path.join(dir, "model.json"), saved);
  return saved;
}

export function deleteModel(id: string) {
  fs.rmSync(dirFor(id), { recursive: true, force: true });
}

interface VersionFile extends VersionInfo {
  model: DataModel;
}

export function listVersions(id: string): VersionInfo[] {
  const dir = path.join(dirFor(id), "versions");
  return versionFiles(id)
    .map((f) => {
      const { model: _m, ...info } = readJson<VersionFile>(path.join(dir, f));
      return info;
    })
    .reverse();
}

export function createVersion(model: DataModel, message: string): VersionInfo {
  const saved = saveModel(model);
  const dir = path.join(dirFor(model.id), "versions");
  fs.mkdirSync(dir, { recursive: true });
  const files = versionFiles(model.id);
  const version = files.length ? parseInt(files[files.length - 1], 10) + 1 : 1;
  const info: VersionInfo = { version, message, createdAt: new Date().toISOString(), tableCount: saved.tables.length };
  writeJson(path.join(dir, String(version).padStart(4, "0") + ".json"), { ...info, model: saved });
  return info;
}

export function getVersion(id: string, version: number): DataModel | null {
  const file = path.join(dirFor(id), "versions", String(version).padStart(4, "0") + ".json");
  return fs.existsSync(file) ? readJson<VersionFile>(file).model : null;
}

// ---- settings (API keys stay on the server and are never sent back to the browser) ----

export interface Settings {
  provider?: ProviderId;
  keys?: Partial<Record<ProviderId, string>>;
  models?: Partial<Record<ProviderId, string>>;
  /** Base URL of the custom OpenAI-compatible endpoint. */
  baseUrl?: string;
  /** Legacy single-provider fields, read once and migrated. */
  apiKey?: string;
  aiModel?: string;
}

export function readSettings(): Settings {
  const s: Settings = fs.existsSync(SETTINGS_FILE) ? readJson<Settings>(SETTINGS_FILE) : {};
  if (s.apiKey || s.aiModel) {
    s.keys = { anthropic: s.apiKey, ...s.keys };
    s.models = { anthropic: s.aiModel, ...s.models };
    delete s.apiKey;
    delete s.aiModel;
  }
  return s;
}

export function writeSettings(next: Settings) {
  writeJson(SETTINGS_FILE, next, 0o600);
  fs.chmodSync(SETTINGS_FILE, 0o600);
}

/** Everything needed to call one provider: key (settings first, then environment), model, base URL. */
export function resolveProvider(id?: string) {
  const s = readSettings();
  const info = provider(id ?? s.provider);
  const stored = s.keys?.[info.id];
  const env = info.env ? process.env[info.env] : undefined;
  return {
    info,
    key: stored || env || undefined,
    keySource: (stored ? "settings" : env ? "env" : "none") as "settings" | "env" | "none",
    model: s.models?.[info.id] || info.defaultModel,
    baseUrl: (info.id === "custom" ? s.baseUrl ?? "" : info.baseUrl).replace(/\/+$/, ""),
  };
}
