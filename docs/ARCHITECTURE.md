# Architecture

## Stack

- **Framework**: Next.js (App Router) with TypeScript.
- **Styling**: Tailwind CSS.
- **Database / auth**: Supabase (Postgres + auth + RLS).
- **Graph rendering**: React Flow via `@xyflow/react`.
- **Validation**: Zod for AI response schemas and API inputs.
- **AI**: provider abstracted behind a server-side route; OpenAI is the default starting point.

## High-Level Layers

```
┌──────────────────────────────────────────────────────┐
│                    Browser (Client)                  │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Input panel  │  │   Canvas    │  │ Node detail │  │
│  └──────┬───────┘  └─────┬───────┘  └─────┬───────┘  │
└─────────┼────────────────┼────────────────┼──────────┘
          │ POST           │ fetch graph    │ fetch node
          ▼                ▼                ▼
┌──────────────────────────────────────────────────────┐
│              Next.js API routes (Server)             │
│  /api/memory  /api/suggest  /api/graph  /api/accept  │
└──────────┬───────────────────────────────┬───────────┘
           │                               │
           ▼                               ▼
   ┌──────────────┐               ┌──────────────────┐
   │ AI provider  │               │ Supabase (PG +   │
   │ (server-only │               │ auth + RLS)      │
   │  API key)    │               │                  │
   └──────────────┘               └──────────────────┘
```

## Folder Layout

```
src/
  app/
    (routes, layouts, API endpoints)
  components/
    canvas/    React Flow wrappers, node/edge renderers
    input/     Thought input panel and submit logic
    nodes/     Node detail panel, node cards
  lib/
    ai/        Prompts, Zod schemas, provider client
    graph/     Pure graph utilities (apply suggestion, dedupe)
    supabase/  Server and browser Supabase clients, queries
  types/       Shared TS types
supabase/
  migrations/  SQL migrations
docs/          Product and engineering docs
```

## Data Flow: Submitting a Thought

1. User types into the input panel and submits.
2. Client POSTs to `/api/memory` with the raw text.
3. Server inserts a row into `memory_entries`.
4. Server calls `/api/suggest` (or the same route, after insertion) which:
   - loads relevant existing nodes (keyword / recency match for MVP),
   - sends the raw entry + context to the AI provider,
   - parses the response through a Zod schema,
   - stores the parsed result in `ai_suggestions` tied to the memory entry.
5. Client receives the suggestion and shows it for review.
6. User accepts (or edits / rejects) the suggestion.
7. On accept, client POSTs to `/api/accept`, which:
   - applies the suggestion to `nodes` / `edges`,
   - creates `node_memory_links` so the raw entry is preserved as part of the node's memory trail,
   - marks the suggestion as accepted.
8. Client refreshes the canvas.

## Server vs. Client Boundary

- AI provider keys live only on the server. All AI calls go through `/api/*` routes.
- Supabase service-role key is server-only. Browser uses the anon key plus RLS policies.
- AI prompt logic stays in `src/lib/ai/`, never inside React components.

## Failure Modes

- **AI returns malformed JSON.** Zod validation fails → return a structured error to the client and keep the raw memory entry. The thought is never lost.
- **Suggestion is rejected.** Memory entry remains in `memory_entries`. User can ask for a new suggestion later.
- **DB write fails after AI call.** Surface the error; the raw entry insert happens first so nothing is silently discarded.

## Why These Choices

- **Next.js App Router**: server components + API routes in one project, minimal config.
- **Supabase**: managed Postgres with auth and RLS — short path to a personal-use product without writing an auth layer.
- **React Flow**: covers pan/zoom/select/drag of graphs with sensible defaults; avoid building a canvas engine from scratch.
- **Zod**: AI output is the most fragile boundary in the system. Validation is non-negotiable.
