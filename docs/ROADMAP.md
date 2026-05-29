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

## Stage 2 — Raw thought input + persistence ✅

- Input panel UI (`src/components/input/thought-input-form.tsx`) and
  recent-thoughts list (`src/components/input/recent-thoughts-list.tsx`).
- Server action `createMemoryEntryAction` in `src/lib/memory/actions.ts`
  validates input (non-empty, ≤5000 chars), uses the user-scoped
  Supabase client, and inserts into `memory_entries` with
  `source: "manual"` and an empty metadata object.
- `listRecentMemoryEntries` (`src/lib/memory/queries.ts`) loads the
  20 most-recent entries for the signed-in user.
- No AI call yet — thoughts persist and round-trip per user only.

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

## Stage 8 — Document ingestion ✅

- Migration `20260530000000_add_document_ingestion.sql`:
  `source_documents`, `document_chunks`, `document_notes`, extends
  `nodes.origin` CHECK with `'document_ai'`, private
  `mindnode-documents` storage bucket with per-user folder policies.
- Extraction in `src/lib/documents/extract.ts` for `.txt` / `.md`
  (TextDecoder), `.pdf` (pdf-parse) and `.docx` (mammoth). 250k char cap.
- Paragraph-aware chunker in `src/lib/documents/chunk.ts`
  (target 1500 / max 1800 words, 30-chunk hard cap).
- AI pipeline (`src/lib/ai/document-prompts.ts`,
  `src/lib/ai/document-schema.ts`, `src/lib/documents/process.ts`):
  Zod-validated note schema with single retry; anchored prompt that
  bans invented facts and requires a literal `source_excerpt`.
- `/api/documents/upload` route: validates, stores privately, extracts,
  chunks, runs AI, creates nodes with `origin='document_ai'`, same-document
  edges + conservative external links via `suggested_relationships`.
- UI: header Documents button → list + upload sheet; node-detail shows
  Document origin badge with source filename and quoted excerpt.

## Later (not scheduled)

- OCR for image-only PDFs.
- Embedding-based related-node retrieval and document semantic search.
- Background job queue for large documents.
- Streaming AI suggestions.
- Mobile-friendly layout.
- Multi-step AI reasoning (retrieve → propose → critique).
