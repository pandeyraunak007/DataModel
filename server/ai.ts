// Modeling Copilot: a streaming tool loop that can read and edit the open model.
// Anthropic uses its own SDK; every other provider goes through the OpenAI chat-completions protocol.
import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { describeIntent } from "../shared/intent.ts";
import { applyOperations, compatOperationsJsonSchema, describeModel, normalizeCompatInput, operationsJsonSchema, OperationsInput } from "../shared/ops.ts";
import type { DataModel } from "../shared/types.ts";
import { resolveProvider } from "./store.ts";

const SYSTEM = `You are the Modeling Copilot built into Forma Studio, an AI-first data modeling tool (visual model canvas, reverse engineering from live databases, forward engineering to DDL, model comparison, validation, and versioned JSON models).

You work alongside a data modeler on the model that is open in the app. Each user message carries three things: the modeling context the modeler declared for this model inside <modeling_context> tags, the current state of the model inside <current_model> tags, and sometimes extra material inside <context> tags (for example a DDL script, a validation finding, or the differences between two model versions).

The modeling context is what makes your advice useful, so let it decide what "good" means. A star schema is judged by fact grain, conformed dimensions, surrogate keys and measure additivity, and its denormalized dimensions are correct by design. A 3NF model is judged by keys, dependencies and referential integrity. A Data Vault is judged by hubs, links, satellites and business keys. Follow the declared grain, history strategy, naming convention, primary key strategy and guardrails, and say so when a request conflicts with them. When you create tables, set their subject area, and set their role when the methodology has roles (fact, dimension, hub, link, satellite).

When the user asks you to create, import, change, fix, or extend the model, make the change yourself with the apply_operations tool rather than describing what they should click. Batch related operations into one call, creating tables before the relationships that reference them. When you import a DDL script or build a model from a description, carry over every table, column, key, and foreign key. Use SQL types that are valid in the model's dialect. After the tool returns, tell the user briefly what changed; if an operation failed, say so and fix it.

When the user asks a question (explain the model, review it, suggest indexes, write a query, assess a migration), answer directly and do not change the model unless they asked for changes. If a review turns up problems, list them and offer to apply the fixes.

Follow sound modeling practice: every table has a primary key, foreign key columns match the type of the column they reference, names follow the declared naming convention (or the one already present in the model), and junction tables resolve many-to-many relationships.

Replies appear in a narrow side panel, so keep them short and concrete. Use plain paragraphs, short lists, and fenced code blocks for SQL.`;

const TOOL_DESCRIPTION =
  "Edit the open data model. Applies a list of operations in order (add/update/drop/rename tables, add/alter/drop columns, add/drop foreign keys and indexes) and returns one result line per operation.";

export interface ChatRequest {
  model: DataModel;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
  context?: string;
}

type Resolved = ReturnType<typeof resolveProvider>;
interface Run {
  req: ChatRequest;
  userContent: string;
  send: (event: Record<string, unknown>) => void;
  signal: AbortSignal;
  /** Validate and apply one tool call; emits the ops/model events and returns the tool result text. */
  exec: (input: unknown) => { content: string; isError: boolean };
  p: Resolved;
}

class ProviderError extends Error {}

export async function chat(req: ChatRequest, res: Response) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const p = resolveProvider();
  if (p.info.id === "custom" ? !p.baseUrl : !p.key) {
    send({ type: "error", message: `No API key configured for ${p.info.label}. Open Settings to add one.` });
    return res.end();
  }

  let model = req.model;
  let changed = false;
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const run: Run = {
    req,
    p,
    send,
    signal: controller.signal,
    userContent:
      `<modeling_context>\n${describeIntent(model)}\n</modeling_context>\n` +
      `<current_model>\n${describeModel(model)}\n</current_model>\n` +
      (req.context ? `<context>\n${req.context}\n</context>\n` : "") +
      `\n${req.message}`,
    exec: (input) => {
      const parsed = OperationsInput.safeParse(input);
      if (!parsed.success)
        return { isError: true, content: "Invalid operations: " + parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      const out = applyOperations(model, parsed.data.operations);
      model = out.model;
      changed = true;
      send({ type: "ops", results: out.results });
      send({ type: "model", model });
      return { isError: false, content: out.results.map((r) => (r.ok ? "OK: " : "ERROR: ") + r.message).join("\n") };
    },
  };

  try {
    await (p.info.id === "anthropic" ? runAnthropic(run) : runCompat(run));
    send({ type: "done", changed });
  } catch (err) {
    if (controller.signal.aborted) return;
    let message: string;
    if (err instanceof Anthropic.AuthenticationError) message = "The API key was rejected. Check it in Settings.";
    else if (err instanceof Anthropic.PermissionDeniedError) message = `This API key cannot use ${p.model}. Pick another model in Settings.`;
    else if (err instanceof Anthropic.NotFoundError) message = `Model "${p.model}" was not found. Pick another model in Settings.`;
    else if (err instanceof Anthropic.RateLimitError) message = "Rate limited by the API. Wait a moment and try again.";
    else if (err instanceof Anthropic.APIError) message = `API error ${err.status ?? ""}: ${err.message}`;
    else message = (err as Error).message;
    send({ type: "error", message });
  } finally {
    res.end();
  }
}

// ---------------------------------------------------------------- Anthropic

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]);

async function runAnthropic({ req, userContent, send, signal, exec, p }: Run) {
  const client = new Anthropic({ apiKey: p.key });
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = req.history.filter((h) => h.text.trim()).map((h) => ({ role: h.role, content: h.text }));
  messages.push({ role: "user", content: userContent });
  const tools: Anthropic.Beta.Messages.BetaTool[] = [
    { name: "apply_operations", description: TOOL_DESCRIPTION, input_schema: operationsJsonSchema, eager_input_streaming: true },
  ];

  let jsonRetries = 0;
  for (let turn = 0; turn < 12; turn++) {
    const stream = client.beta.messages.stream(
      {
        model: p.model,
        max_tokens: 32000,
        system: SYSTEM,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        tools,
        messages,
        // On a safety-classifier decline, re-run the request on a fallback model in the same call.
        ...(FALLBACK_MODELS.has(p.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );
    stream.on("text", (delta) => send({ type: "text", delta }));
    stream.on("streamEvent", (e) => {
      if (e.type === "content_block_start" && e.content_block.type === "tool_use") send({ type: "status", message: "Editing the model…" });
    });

    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming an unparseable tool input rejects here; re-issue that turn.
      if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === "refusal") return send({ type: "error", message: "The model declined this request." });
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const toolUses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) {
      if (message.stop_reason === "max_tokens") send({ type: "error", message: "The reply was cut off at the output limit." });
      return;
    }
    if (message.stop_reason === "max_tokens")
      return send({ type: "error", message: "The edit was too large for one reply and was not applied. Ask for it in smaller steps." });

    messages.push({ role: "assistant", content: message.content });
    messages.push({
      role: "user",
      content: toolUses.map((tu) => {
        const r = exec(tu.input);
        return { type: "tool_result" as const, tool_use_id: tu.id, is_error: r.isError, content: r.content };
      }),
    });
  }
}

// ---------------------------------------------------------------- OpenAI-compatible (OpenAI, Gemini, Groq, custom)

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Provider extras that must be echoed back (Gemini thought signatures). */
  extra_content?: unknown;
}

async function compatFetch(p: Resolved, path: string, init: RequestInit = {}): Promise<globalThis.Response> {
  let res: globalThis.Response;
  try {
    res = await fetch(p.baseUrl + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(p.key ? { Authorization: `Bearer ${p.key}` } : {}) },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ProviderError(`Could not reach ${p.info.label} at ${p.baseUrl}: ${(e as Error).message}`);
  }
  if (res.ok) return res;
  const body = await res.text();
  let detail = body.slice(0, 300);
  try {
    const j = JSON.parse(body);
    detail = (Array.isArray(j) ? j[0] : j)?.error?.message ?? detail;
  } catch {}
  if (res.status === 401 || res.status === 403) throw new ProviderError(`${p.info.label} rejected the API key. Check it in Settings. (${detail})`);
  if (res.status === 404) throw new ProviderError(`${p.info.label} does not know the model "${p.model}". Pick another model in Settings. (${detail})`);
  if (res.status === 429) throw new ProviderError(`${p.info.label} rate limit or quota reached. ${detail}`);
  throw new ProviderError(`${p.info.label} error ${res.status}: ${detail}`);
}

async function runCompat({ req, userContent, send, signal, exec, p }: Run) {
  const messages: Record<string, unknown>[] = [
    { role: "system", content: SYSTEM },
    ...req.history.filter((h) => h.text.trim()).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: userContent },
  ];
  const tools = [{ type: "function", function: { name: "apply_operations", description: TOOL_DESCRIPTION, parameters: compatOperationsJsonSchema } }];

  for (let turn = 0; turn < 12; turn++) {
    const res = await compatFetch(p, "/chat/completions", { method: "POST", signal, body: JSON.stringify({ model: p.model, messages, tools, stream: true }) });
    let text = "";
    let finish = "";
    const calls: ToolCall[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new ProviderError(`${p.info.label}: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const d = choice.delta ?? {};
        if (typeof d.content === "string" && d.content) {
          text += d.content;
          send({ type: "text", delta: d.content });
        }
        for (const tc of d.tool_calls ?? []) {
          const i = typeof tc.index === "number" ? tc.index : calls.length;
          if (!calls[i]) {
            calls[i] = { id: tc.id || `call_${turn}_${i}`, type: "function", function: { name: "", arguments: "" } };
            send({ type: "status", message: "Editing the model…" });
          }
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) calls[i].function.name = tc.function.name;
          if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
          if (tc.extra_content) calls[i].extra_content = tc.extra_content;
        }
      }
    }

    const toolCalls = calls.filter(Boolean);
    if (!toolCalls.length) {
      if (finish === "length") send({ type: "error", message: "The reply was cut off at the model's output limit." });
      return;
    }
    if (finish === "length") return send({ type: "error", message: "The edit was too large for one reply and was not applied. Ask for it in smaller steps." });

    messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      let r: { content: string; isError: boolean };
      if (tc.function.name !== "apply_operations") r = { isError: true, content: `Unknown tool "${tc.function.name}". The only tool is apply_operations.` };
      else {
        try {
          r = exec(normalizeCompatInput(JSON.parse(tc.function.arguments || "{}")));
        } catch {
          r = { isError: true, content: "The tool arguments were not valid JSON. Send the call again." };
        }
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: r.content });
    }
  }
}

// ---------------------------------------------------------------- model discovery

/** Ask the provider which models this key can use. */
export async function listModels(providerId: string): Promise<string[]> {
  const p = resolveProvider(providerId);
  if (p.info.id === "anthropic") {
    if (!p.key) throw new Error("Save an API key first.");
    const ids: string[] = [];
    try {
      for await (const m of new Anthropic({ apiKey: p.key }).models.list()) ids.push(m.id);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error("The API key was rejected.");
      throw e;
    }
    return ids;
  }
  if (!p.baseUrl) throw new Error("Save a base URL first.");
  if (!p.key && p.info.id !== "custom") throw new Error("Save an API key first.");
  const res = await compatFetch(p, "/models");
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id.replace(/^models\//, "")).sort();
}
