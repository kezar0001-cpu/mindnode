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

## Stage 7 — Document graph extraction (in progress)

- Migration `20260530010000_document_graph_redesign.sql`: adds
  `document_root` / `document_section` to `nodes.origin`, `document_ai` /
  `document_structure` to `edges.origin`, `processed_with_warnings` status,
  `document_sections` table, `document_chunks.section_*` metadata,
  diagnostics + warnings columns on `source_documents`, node_type / tags /
  importance / stable_key on `document_notes`.
- Section parser (`src/lib/documents/structure.ts`) detects Markdown
  ATX/Setext, ALL-CAPS, and Title-Case headings.
- Section-aware chunker (`src/lib/documents/chunk.ts`) preserves section
  boundaries; chunks carry section metadata; hard cap raised to 60.
- Model router (`src/lib/ai/models.ts`, `router.ts`) with `AI_MODEL_*` env
  vars per task and sensible defaults.
- `chatCompletionStructured` in `provider.ts` uses OpenAI Structured
  Outputs (`json_schema`, strict) at a lower temperature for extraction.
- Two-pass processor (`src/lib/documents/process.ts`):
  Pass 1 creates the document root + section nodes with `contains` edges;
  Pass 2 calls graph extraction per section with retry, creates typed
  child nodes (`node_type`, `importance`, `tags`, `stable_key`,
  `source_excerpt`) and typed semantic relationships.
- Similarity helper (`src/lib/graph/similarity.ts`) replaces the
  `same_document` chain with conservative `relates_to` links to existing
  graph nodes (≥2 shared meaningful tokens, or 1 + category match).
- Cluster layout (`src/lib/documents/layout.ts`) places root at centroid,
  sections radially, children fanned away from the root.
- Quality guard: low-yield uploads marked `processed_with_warnings`;
  diagnostics stored on the source document.
- UI: stage cycler in upload sheet; document status card shows
  section/chunk/node/edge counts and warnings; node detail shows
  `node_type` pill and section title for any document-origin node.

---

# Product roadmap to v1

The end goal: a personal thinking and planning system. The user unloads
thoughts and documents, the AI helps develop plans and surface missed
avenues, and the user explores everything through the canvas or the chat
companion — with full control over which branches exist and which are
visible.

## Phase A — Source-Grounded Chat Brain ✅

- `/api/chat` (POST + GET): answers grounded in graph nodes, edges, source
  chunks, and recent thoughts; persisted conversations; citations.
- Proposed graph changes reviewed in chat (Add all / Add selected / Dismiss),
  applied with origin `chat_suggested`. Never auto-applied.
- Node-focused chat from the node detail sheet.
- Tables: `chat_conversations`, `chat_messages`, `chat_graph_suggestions`.

## Phase B — Graph usability & source navigation ✅

- Focus/Global view model (`src/lib/graph/view-model.ts`); focus default
  above 20 nodes; canvas renders a derived view, DB stays source of truth.
- Documents collapse to a single root node; expand/collapse per document.
- Deterministic cluster layout with spacing scaled to section count; new
  clusters placed clear of the existing graph.
- Stale "Working…" documents reconciled to `processed_with_warnings`
  (Recovered) or `failed` (`src/lib/documents/reconcile.ts`).
- Document graph deletion includes section nodes, sections, and chunks.
- Edge-label thinning, origin badges, larger document roots.

## Phase C — Branch control ✅

- Contract/Expand branch per node: hides/reveals the downstream branch on
  the canvas with a "+N hidden" badge on the contracted anchor.
- Delete branch: removes a node and its entire downstream branch (edges,
  memory links cleared; raw memories preserved; document provenance
  references nulled) with a count preview and two-step confirm.

## Phase D — Retrieval depth ✅

- Migration `20260610000000_add_embeddings_and_chat_memory.sql`: pgvector,
  `nodes.embedding` / `document_chunks.embedding` vector(1536) with HNSW
  indexes, `chat_conversations.summary`, and user-scoped `match_nodes` /
  `match_document_chunks` RPCs (SECURITY INVOKER + auth.uid()).
- Hybrid retrieval (`src/lib/chat/retrieval.ts`): query embedded once;
  vector similarity blended with keyword overlap (vector 1.0 / keyword 0.5,
  similarity floor 0.25). Degrades cleanly to keyword-only when the
  provider or migration is unavailable.
- Embedding sync (`src/lib/ai/embedding-sync.ts`): inline on node
  create/update (memory promotion, ghost pin, chat apply), batch after
  document processing, opportunistic capped backfill in the chat route.
- Chat memory: rolling per-conversation summary (`chat-summary.ts`,
  `AI_MODEL_CHAT_SUMMARY`); recent summaries fed into new conversations as
  PRIOR CONVERSATIONS context.
- Tappable citations: citation labels resolved server-side to node ids
  (documents resolve to their root node); tapping a chip closes the chat
  and focuses the node on the canvas.

## Phase E — Planning workflows

- "Develop a plan" chat mode: AI proposes a staged plan as a reviewable
  branch (goal → stages → next steps) anchored to a selected node.
- Plan nodes get checkable progress state; the canvas shows progress.
- Periodic "missed avenues" review: AI scans the graph for stale branches,
  contradictions, and unexplored connections.

## Phase F — Polish for daily use

- Streaming chat responses.
- Background processing for large documents (status polling instead of one
  long request).
- OCR for image-only PDFs.
- Canvas mini-map and keyboard navigation on desktop.
- Auto-layout pass for hand-made tangles.
