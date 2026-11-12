# Forma Studio

AI-first, web-based data modeler: diagram canvas, reverse engineering, forward engineering,
model compare, and JSON models with versions.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173, then choose an AI provider and add its API key under **Settings**.
Supported: Anthropic, OpenAI, Google Gemini, Groq, and any OpenAI-compatible endpoint (Ollama, OpenRouter...).
Keys can also come from the server environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`.

## What is where

| Path | Purpose |
|---|---|
| `shared/types.ts` | The model JSON format |
| `shared/ddl.ts` | Forward engineering (PostgreSQL, MySQL, SQL Server, SQLite, Snowflake) |
| `shared/diff.ts` | Model compare and migration scripts |
| `shared/intent.ts` | Modeling intent: patterns, guardrails, table roles, the context given to the copilot |
| `shared/validate.ts` | Intent-aware validation rules |
| `shared/ops.ts` | Edit operations the copilot uses |
| `server/introspect.ts` | Reverse engineering from live PostgreSQL, MySQL, SQL Server, SQLite |
| `server/ai.ts` | Copilot tool loop (Anthropic SDK, plus an OpenAI-compatible client for the other providers) |
| `server/providers.ts` | Provider registry: endpoints, default models, key environment variables |
| `server/store.ts` | File storage: `data/models/<id>/model.json` and `versions/NNNN.json` |
| `src/` | React app: landing, guided setup, workspace (explorer, canvas, inspector, copilot) |

The API server listens on 127.0.0.1:4177 only. `data/settings.json` (your API key) is git-ignored.
