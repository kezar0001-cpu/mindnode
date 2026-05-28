# Roadmap

Staged plan. Each stage should land in small commits and be usable end-to-end before moving on.

## Stage 0 — Scaffold (this branch)

- Next.js + TypeScript + Tailwind project.
- Folder structure per `ARCHITECTURE.md`.
- Documentation in `docs/`.
- `.env.example` with required variable names.
- Lint, type-check, and build scripts wired up.

**Out of scope**: any real feature work.

## Stage 1 — Database schema

- Supabase migration creating `memory_entries`, `nodes`, `edges`, `ai_suggestions`, `node_memory_links`.
- RLS policies (`user_id = auth.uid()`).
- Server and browser Supabase clients in `src/lib/supabase/`.

## Stage 2 — Raw thought input + persistence

- Input panel UI.
- `/api/memory` route that inserts into `memory_entries`.
- No AI call yet — just confirm thoughts persist.

## Stage 3 — Basic canvas

- React Flow canvas rendering `nodes` and `edges` for the signed-in user.
- Pan, zoom, select. No editing yet.

## Stage 4 — AI suggestion pipeline

- `/api/suggest` route: load context, call provider, validate with Zod, store in `ai_suggestions`.
- Suggestion review UI: show the AI's proposed action and explanation.

## Stage 5 — Accept / apply

- `/api/accept` route: apply the suggestion to `nodes` / `edges` / `node_memory_links` in a transaction.
- Reject path: mark suggestion `rejected`, leave the raw entry untouched.

## Stage 6 — Node detail panel

- Right-side panel listing summary, category, and linked raw memory entries for the selected node.
- Show connected nodes.

## Stage 7 — Basic search / retrieval

- Simple text search across `memory_entries` and `nodes`.
- Surface results that focus the canvas on the matching node.

## Later (not scheduled)

- Embedding-based related-node retrieval.
- Streaming AI suggestions.
- Mobile-friendly layout.
- Multi-step AI reasoning (retrieve → propose → critique).
