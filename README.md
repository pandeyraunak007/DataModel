# DataModel Studio

AI-first, web-based data modeler: diagram canvas, reverse engineering, forward engineering,
model compare, and JSON models with versions.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173, then add your Anthropic API key under **Settings**
(or start the server with `ANTHROPIC_API_KEY` set).

## What is where

| Path | Purpose |
|---|---|
| `shared/types.ts` | The model JSON format |
| `shared/ddl.ts` | Forward engineering (PostgreSQL, MySQL, SQL Server, SQLite, Snowflake) |
| `shared/diff.ts` | Model compare and migration scripts |
| `shared/ops.ts` | Edit operations the AI assistant uses |
| `server/introspect.ts` | Reverse engineering from live PostgreSQL, MySQL, SQL Server, SQLite |
| `server/ai.ts` | Claude tool loop behind the assistant |
| `server/store.ts` | File storage: `data/models/<id>/model.json` and `versions/NNNN.json` |
| `src/` | React app (React Flow canvas, editors, dialogs, assistant) |

The API server listens on 127.0.0.1:4177 only. `data/settings.json` (your API key) is git-ignored.
