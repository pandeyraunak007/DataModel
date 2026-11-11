// AI assistant: a streaming Claude tool loop that can read and edit the current model.
import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { applyOperations, describeModel, operationsJsonSchema, OperationsInput } from "../shared/ops.ts";
import type { DataModel } from "../shared/types.ts";
import { DEFAULT_AI_MODEL, readSettings, resolveApiKey } from "./store.ts";

const SYSTEM = `You are the data modeling assistant built into DataModel Studio, a web-based database modeling tool (ER diagram canvas, reverse engineering from live databases, forward engineering to DDL, model comparison, and versioned JSON models).

You work alongside a data modeler on the model that is open in the app. Each user message carries the current state of that model inside <current_model> tags, and sometimes extra material inside <context> tags (for example a DDL script, or the differences between two model versions).

When the user asks you to create, import, change, fix, or extend the model, make the change yourself with the apply_operations tool rather than describing what they should click. Batch related operations into one call, creating tables before the relationships that reference them. When you import a DDL script or build a model from a description, carry over every table, column, key, and foreign key. Use SQL types that are valid in the model's dialect. After the tool returns, tell the user briefly what changed; if an operation failed, say so and fix it.

When the user asks a question (explain the model, review it, suggest indexes, write a query, assess a migration), answer directly and do not change the model unless they asked for changes. If a review turns up problems, list them and offer to apply the fixes.

Follow sound modeling practice: every table has a primary key, foreign key columns match the type of the column they reference, names follow the convention already present in the model (snake_case if the model is empty), and junction tables resolve many-to-many relationships.

Replies appear in a narrow side panel, so keep them short and concrete. Use plain paragraphs, short lists, and fenced code blocks for SQL.`;

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]);

export interface ChatRequest {
  model: DataModel;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
  context?: string;
}

type Beta = Anthropic.Beta.Messages.BetaMessageParam;

export async function chat(req: ChatRequest, res: Response) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const { key } = resolveApiKey();
  if (!key) {
    send({ type: "error", message: "No API key configured. Open Settings and add your Anthropic API key." });
    return res.end();
  }

  const client = new Anthropic({ apiKey: key });
  const aiModel = readSettings().aiModel || DEFAULT_AI_MODEL;
  let model = req.model;
  let changed = false;

  const messages: Beta[] = req.history.filter((h) => h.text.trim()).map((h) => ({ role: h.role, content: h.text }));
  messages.push({
    role: "user",
    content:
      `<current_model>\n${describeModel(model)}\n</current_model>\n` +
      (req.context ? `<context>\n${req.context}\n</context>\n` : "") +
      `\n${req.message}`,
  });

  const tools: Anthropic.Beta.Messages.BetaTool[] = [
    {
      name: "apply_operations",
      description:
        "Edit the open data model. Applies a list of operations in order (add/drop/rename tables, add/alter/drop columns, add/drop foreign keys and indexes) and returns one result line per operation. The diagram updates immediately.",
      input_schema: operationsJsonSchema,
      eager_input_streaming: true,
    },
  ];

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  try {
    let jsonRetries = 0;
    for (let turn = 0; turn < 12; turn++) {
      const useFallback = FALLBACK_MODELS.has(aiModel);
      const stream = client.beta.messages.stream(
        {
          model: aiModel,
          max_tokens: 32000,
          system: SYSTEM,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          cache_control: { type: "ephemeral" },
          tools,
          messages,
          // On a safety-classifier decline, re-run the request on a fallback model in the same call.
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: controller.signal },
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
        if (err instanceof Anthropic.APIError || controller.signal.aborted || jsonRetries++ >= 2) throw err;
        continue;
      }

      if (message.stop_reason === "refusal") {
        send({ type: "error", message: "The model declined this request." });
        break;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (!toolUses.length) {
        if (message.stop_reason === "max_tokens") send({ type: "error", message: "The reply was cut off at the output limit." });
        break;
      }
      if (message.stop_reason === "max_tokens") {
        send({ type: "error", message: "The edit was too large for one reply and was not applied. Ask for it in smaller steps." });
        break;
      }

      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const parsed = OperationsInput.safeParse(tu.input);
        if (!parsed.success) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: "Invalid operations: " + parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          });
          continue;
        }
        const out = applyOperations(model, parsed.data.operations);
        model = out.model;
        changed = true;
        send({ type: "ops", results: out.results });
        send({ type: "model", model });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out.results.map((r) => (r.ok ? "OK: " : "ERROR: ") + r.message).join("\n") });
      }
      messages.push({ role: "user", content: results });
    }
    send({ type: "done", changed });
  } catch (err) {
    if (controller.signal.aborted) return;
    let message: string;
    if (err instanceof Anthropic.AuthenticationError) message = "The API key was rejected. Check it in Settings.";
    else if (err instanceof Anthropic.PermissionDeniedError) message = `This API key cannot use ${aiModel}. Pick another model in Settings.`;
    else if (err instanceof Anthropic.NotFoundError) message = `Model "${aiModel}" was not found. Pick another model in Settings.`;
    else if (err instanceof Anthropic.RateLimitError) message = "Rate limited by the API. Wait a moment and try again.";
    else if (err instanceof Anthropic.APIError) message = `API error ${err.status ?? ""}: ${err.message}`;
    else message = (err as Error).message;
    send({ type: "error", message });
  } finally {
    res.end();
  }
}
