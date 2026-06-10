# MindNode — Full Product Review & Improvement Roadmap

_Diagnosis and actionable direction. No code is changed by this document. It ends
with copy-paste prompts you can hand to a coding agent, one per change._

Date: 2026-06-10
Scope reviewed: backend (API routes, AI pipeline, data layer, Supabase schema/RLS),
frontend (workspace, canvas, chat, node detail, documents, input, login), data flows,
reliability, and UX against the stated vision in `CLAUDE.md`, `docs/PRODUCT_SPEC.md`,
and `docs/ROADMAP.md`.

---

## 1. Executive summary

MindNode is **well past MVP**. The codebase has shipped chat grounding, document
ingestion with a two-pass graph extractor, embeddings + hybrid retrieval, plan
workflows, branch control, insights, declutter, and a polished dark canvas. The
architecture is clean, RLS is correct on every table, and AI output is Zod-validated.

However, the review surfaces one **strategic gap** and a cluster of **reliability,
state-management, and UX-consistency issues** that make the product feel slower and
less trustworthy than its underlying capability:

1. **The headline promise is missing from the capture path.** The vision (and
   `PRODUCT_SPEC` success criteria) is: _user types a thought → AI proposes title /
   summary / category / related node / create-vs-update / edges → user accepts._ In
   the current build, a manually typed thought is saved raw, and "Add to canvas"
   (`createNodeFromMemoryAction`) derives a title from the first 8 words, hardcodes
   `category: "general"`, and links only by keyword overlap. **No AI runs on the
   primary capture flow.** AI lives only in chat, document upload, and ghost
   exploration. The `ai_suggestions` table and the `/api/suggest` + `/api/accept`
   routes (Roadmap Stages 4–5) were never built — they are dead schema.

2. **Almost every mutation triggers a full `router.refresh()`**, causing flicker,
   lost local state (ghosts, scroll, selection), and redundant full-graph reloads.
   There is no optimistic UI and no granular cache.

3. **No transactions, timeouts, or retries** anywhere in the AI/data pipelines.
   Multi-step writes (chat, document processing, ghost pin) can orphan data; external
   AI/embedding `fetch` calls can hang indefinitely.

4. **UX inconsistency**: errors don't auto-dismiss, there are four different mental
   models for "adding" a node, header icons lack labels, and several powerful actions
   (insights, exploration) are hard to discover.

5. **Zero automated tests.** No unit, integration, or e2e coverage; CI is limited to
   `lint` + `typecheck` scripts.

The good news: the data model and AI plumbing needed to close the strategic gap
**already exist** (embeddings, retrieval, Zod schemas, suggestion-review UI in chat).
Most recommendations are wiring and polish, not new infrastructure.

---

## 2. Current state vs. stated vision

| Vision (CLAUDE.md / PRODUCT_SPEC) | Status | Notes |
|---|---|---|
| Submit a thought, saved as raw memory | ✅ | `createMemoryEntryAction`, append-only, RLS-safe |
| AI suggests title/summary/category on the thought | ❌ | Never built; title is first-8-words, category hardcoded |
| AI suggests related node + create-vs-update decision | ❌ | Only keyword auto-link on promotion; no update path |
| AI suggests edges | ⚠️ | Only via chat suggestions / exploration ghosts, not on capture |
| User accepts a reviewable suggestion | ⚠️ | Exists for chat + ghosts, **not** for typed thoughts |
| Canvas of nodes/edges, pan/zoom/select | ✅ | React Flow, focus/global view model, minimap, keyboard nav |
| Node detail: summary, memory trail, connections | ✅ | Rich detail sheet |
| Persist in Supabase | ✅ | Full schema, RLS, embeddings |
| Prefer updating/linking existing nodes over duplicates | ⚠️ | Keyword + doc similarity only; capture path always creates new |
| Search / retrieval | ⚠️ | Client-side substring over node titles only; ignores raw memories & doc chunks despite embeddings existing |
| Beyond MVP: chat brain, documents, plans, insights | ✅ | All shipped |

**Takeaway:** the product over-delivered on Phases A–F but skipped the original Stage
4–5 "thought → AI suggestion → accept" loop that the vision treats as the core ritual.

---

## 3. Diagnosis by category

### A. Core functionality gaps

- **A1 — No AI on the primary capture loop.** Typed thoughts never get an AI-proposed
  node. `createNodeFromMemoryAction` (`src/lib/graph/actions.ts:104`) derives a title
  with `deriveTitle` (first 8 words, line 73), hardcodes `category: "general"`
  (line 145), and links only via `findRelatedNodesByKeywords`. The product's defining
  ritual is absent.
- **A2 — No "update existing node vs. create new" decision.** Promotion always
  inserts a new node. Embeddings exist (`match_nodes` RPC) but are not consulted at
  capture to detect "this belongs to an existing node."
- **A3 — Captured thoughts can silently die.** After saving, the FAB sheet closes and
  nothing prompts the user. To turn a thought into a node they must reopen "Recent
  thoughts" and click "Add to canvas." There's no badge/count of un-promoted thoughts,
  so brain-dumps accumulate unseen.
- **A4 — Weak global search.** `searchResults` in `mind-workspace.tsx` filters
  `initialNodes` by title/summary substring, capped at 20, client-side. It ignores raw
  `memory_entries` content and `document_chunks` entirely — even though hybrid vector
  search already exists for chat. Users can't find a thought they typed last month.
- **A5 — No edit/delete/re-promote for raw memory entries.** Append-only is fine, but
  there is no correction path for a typo'd thought, and no way to re-run promotion.
- **A6 — Chat message lost on AI failure.** In `/api/chat` POST, the user turn is
  inserted only **after** a successful generation (`route.ts:233`). A 502 from the
  model drops the user's typed message entirely.

### B. Workflow / process

- **B1 — Onboarding is a single empty-state line.** First-run gives "Capture your
  first thought" + an arrow, but never demonstrates the capture → AI structure →
  explore loop, so the canvas's value isn't conveyed.
- **B2 — Ghost pin → invisible until refresh.** `pinGhostSuggestionAction` succeeds and
  marks the ghost pinned, but the real node doesn't appear until a `router.refresh()`
  that isn't called on that path. The user sees nothing happen.
- **B3 — Fake document upload progress.** `document-upload-sheet.tsx` animates 4 timed
  stages (~7s) that don't reflect server reality. Real processing is synchronous with a
  120s `maxDuration` cap; large PDFs can exceed it and the user just sees a spinner or a
  generic failure. No real progress, ETA, or background job.
- **B4 — Insights & exploration are under-explained.** "Find avenues", "Suggest
  bridge", "Suggest avenues" produce ghosts but the UI doesn't explain what they do or
  when to use them; the value is buried behind unlabeled icons.
- **B5 — No undo for destructive actions.** Delete node / branch / edge are permanent
  (two-step confirm only). Branch delete shows a count but not _which_ nodes.
- **B6 — Plan creation is chat-only.** A node can't be converted to a plan step from the
  canvas; `setPlanStatusAction` only works on nodes already `origin: plan`.

### C. UI / UX layout & interaction

- **C1 — Unlabeled, competing entry points.** The header packs ~7 icon-only buttons;
  the FAB adds a thought; ghosts add nodes; chat proposes nodes; documents generate
  nodes. Four "add" mental models, no tooltips, no clear primary action.
- **C2 — Inconsistent, sticky feedback.** Some feedback is a toast (upload, AI error),
  some is persistent inline text (node edit, edge, chat error). Errors don't auto-
  dismiss and can stack, blocking input areas.
- **C3 — Bottom-sheet-only on desktop.** The mobile-first bottom sheet (75vh) is great
  on phones but wastes a large desktop screen and makes the 1000-line node-detail sheet
  feel cramped. No responsive side-panel layout.
- **C4 — Accessibility gaps.** Ghost controls and citations aren't keyboard-reachable;
  disabled states use `aria-disabled` instead of `disabled`; modals have no focus trap
  or Escape-to-close; React Flow nodes have no accessible names; no hover tooltips on
  nodes/edges.
- **C5 — Visual hierarchy.** Strong color system (category/origin/plan), but with many
  origin badges and edge labels the canvas can read as noisy; there's no legend.

### D. Technical / performance / state-management

- **D1 — Refresh-driven state.** Edits, pins, applies, declutter all call
  `router.refresh()` → full re-fetch of 8 queries in `page.tsx` and a full re-render.
  No optimistic updates; local UI state (ghosts, expanded docs, selection) is at risk.
- **D2 — Unbounded full-graph loads.** `listNodes`/`listEdges` load the entire graph
  with no pagination; `page.tsx` runs 8 queries `force-dynamic` on every navigation;
  the client recomputes the view model and styled edges on every render. Fine now,
  degrades past a few hundred nodes.
- **D3 — Heavy, serial chat turns.** `/api/chat` POST runs, in sequence per turn:
  embedding backfill (2×64), hybrid retrieval, the answer generation, **and** a
  separate summary-generation AI call — with no streaming. Turns feel slow.
- **D4 — No transactions.** Chat (3 inserts), document processing (100+ writes), ghost
  pin (node+edge), and branch delete are multi-step with no transaction; a mid-way
  failure orphans rows.
- **D5 — No timeouts / retries / backoff** on any AI or embedding `fetch`
  (`provider.ts`, `embeddings.ts`). A slow upstream hangs the request; a transient 429
  fails immediately.
- **D6 — Silent embedding degradation.** Embedding backfill failures are swallowed;
  vector search silently degrades to keyword-only with no signal — retrieval quality
  can quietly drop.
- **D7 — Schema drift / dead code.** `ai_suggestions` table is unused;
  `embeddings.ts` hardcodes dim 1536 with no guard if the model env changes.
- **D8 — No tests, thin CI.** No unit/integration/e2e; only `lint` + `typecheck`.

---

## 4. Prioritized recommendations

Priority key: **P0** = closes a core promise or a data-loss/reliability hole;
**P1** = meaningful UX/perf win, modest effort; **P2** = polish / scale-ahead.

### Group 1 — Core functionality gaps

| ID | Recommendation | Priority |
|---|---|---|
| 1.1 | **Add AI suggestion on capture.** When a thought is submitted (or promoted), call a new `/api/suggest` that returns a Zod-validated `{action: create\|update\|link, title, summary, category, related_node_ids, suggested_edges, confidence, explanation}`. Show it in the existing suggestion-review UI; on accept, write the node/edges. | **P0** |
| 1.2 | **Create-vs-update via embeddings.** In `/api/suggest`, embed the thought and call `match_nodes`; if top match ≥ threshold, propose _update existing node_ instead of create. Reuses Phase D infra. | **P0** |
| 1.3 | **Surface un-promoted thoughts.** Badge the "Recent thoughts" button with the count of memories without a node; after capture, show a toast with a one-tap "Review suggestion". | **P1** |
| 1.4 | **Real global search.** Replace client substring search with a `/api/search` that runs hybrid vector+keyword over nodes, `memory_entries`, and `document_chunks`; group results by type; tapping focuses the node / opens the memory. | **P1** |
| 1.5 | **Edit/delete a raw memory entry** + "re-run suggestion". | **P2** |
| 1.6 | **Persist the chat user-turn before generation** so a model failure never loses the message; mark the turn failed and allow retry. | **P0** |

### Group 2 — Workflow / process enhancements

| ID | Recommendation | Priority |
|---|---|---|
| 2.1 | **Optimistic ghost pin.** Insert the pinned node into local canvas state immediately (pending style), reconcile on server confirm; remove the stale-until-refresh gap. | **P1** |
| 2.2 | **Honest document upload progress.** Either stream real stage events (extract → chunk → per-section graph) or move processing to a background job and poll `source_documents.status`; remove the fake timed cycler. | **P1** |
| 2.3 | **Guided first-run.** A 3-step coachmark: capture a thought → watch AI structure it → explore/connect. Trigger on empty graph. | **P2** |
| 2.4 | **Explain insights/exploration inline.** Short helper text + a "what's this" affordance on each insight action; show ghost results with a one-line rationale. | **P2** |
| 2.5 | **Undo for destructive actions.** Soft-delete (or a short-lived undo toast) for node/branch/edge deletes; preview the node list for branch delete. | **P2** |
| 2.6 | **Convert node → plan from the canvas** (set `origin: plan`, seed `plan_status: todo`). | **P2** |

### Group 3 — UI/UX layout & interaction improvements

| ID | Recommendation | Priority |
|---|---|---|
| 3.1 | **Label/tooltip every control + define one primary action.** Tooltips on header icons; make "Add thought" the visually dominant action; group secondary tools. | **P1** |
| 3.2 | **Consistent feedback system.** One toast component for transient success/error with auto-dismiss + manual close; reserve inline text for validation only. | **P1** |
| 3.3 | **Responsive layout.** Bottom sheet on mobile; docked right-side panel for node detail/chat on ≥ `lg`. | **P1** |
| 3.4 | **Accessibility pass.** Keyboard access to ghost/citation actions; `disabled` over `aria-disabled`; focus trap + Escape in sheets; accessible names on nodes; hover tooltips with node title. | **P1** |
| 3.5 | **Canvas legend + badge thinning** for category/origin colors to cut visual noise. | **P2** |

### Group 4 — Technical / performance / state-management

| ID | Recommendation | Priority |
|---|---|---|
| 4.1 | **Replace blanket `router.refresh()` with targeted state updates.** Have actions return the created/updated row; merge into client state; reserve refresh for cross-cutting cases. Removes flicker, lost ghosts, redundant fetches. | **P0** |
| 4.2 | **Add timeouts + bounded retry/backoff** to all AI/embedding `fetch` calls (`AbortController`, retry on 429/5xx). | **P0** |
| 4.3 | **Wrap multi-step writes in transactions** (Postgres function / RPC) for chat persistence, document processing, ghost pin, branch delete. | **P1** |
| 4.4 | **Stream chat responses** and move summary generation off the hot path (async / every N turns). | **P1** |
| 4.5 | **Paginate / cap graph loads** and memoize the view model by stable inputs; lazy-load memory trails per node instead of all upfront in `page.tsx`. | **P1** |
| 4.6 | **Surface retrieval degradation** (flag keyword-only mode; log embedding-sync failures with counts). | **P2** |
| 4.7 | **Remove dead `ai_suggestions` schema** (or repurpose for 1.1) and add an embedding-dimension guard. | **P2** |
| 4.8 | **Introduce tests + CI:** unit tests for view-model/retrieval/chunking, integration tests for actions, a smoke e2e for capture→suggest→accept; run on PRs. | **P1** |

---

## 5. Implementation notes (intended behavior · simplest path · changes)

Condensed design for the highest-leverage items. Each maps to a prompt in §6.

- **1.1/1.2 AI capture suggestion.**
  - _Behavior:_ Submitting a thought returns a reviewable suggestion (create or update),
    pre-filled title/summary/category and proposed edges; accept writes to the graph,
    preserving the raw memory link.
  - _Path:_ New `POST /api/suggest` reusing `chatCompletionStructured` + a Zod schema
    (the `AISuggestionPayload` type already exists in `src/types/index.ts:105`). Embed
    the thought, call `match_nodes`, branch on similarity. Reuse the chat
    `SuggestionCard` review UI; on accept call `pinGhostSuggestionAction`-style writes
    or a new `applySuggestionAction`.
  - _Backend:_ new route + schema + accept action; optionally revive `ai_suggestions`
    for the audit trail. _Frontend:_ wire the composer success → review sheet.

- **1.6 Chat turn durability.**
  - _Behavior:_ User message is never lost.
  - _Path:_ Move the user-turn insert above `generateChatResponse` in `route.ts`; on
    failure, mark it `error` and return a retry handle. _Frontend:_ show failed bubble
    with retry.

- **4.1 State without full refresh.**
  - _Behavior:_ Mutations reflect instantly, no flicker, ghosts/selection preserved.
  - _Path:_ Return the affected row from each server action; in `mind-workspace.tsx`
    keep nodes/edges in `useState` seeded from props and apply deltas; drop most
    `router.refresh()` calls.

- **2.2 Honest upload.**
  - _Behavior:_ Progress reflects real work; large docs don't dead-end.
  - _Path (simplest):_ Keep synchronous processing but write `status` transitions to
    `source_documents`, return immediately after enqueue-or-extract, and have the
    sheet poll `status` until terminal. _Path (robust):_ background worker/queue
    (already noted as deferred in the roadmap).

- **4.2 Timeouts/retries.**
  - _Behavior:_ No hung requests; transient errors recover.
  - _Path:_ Wrap `fetch` in `provider.ts` and `embeddings.ts` with `AbortController`
    (e.g. 30s) and a 2–3 try exponential backoff on 429/5xx/network.

---

## 6. Copy-paste follow-up prompts for coding agents

Each block is self-contained. Run **6.1 / 6.2 / 6.7 first** (they close the core
promise and the data-loss/flicker issues); the rest are independent.

> **6.1 — Implement AI suggestion on the thought-capture flow**
> In MindNode, the core vision (CLAUDE.md, docs/PRODUCT_SPEC.md) is "thought → AI
> proposes a node → user accepts," but the capture path has no AI:
> `createNodeFromMemoryAction` derives a title from the first 8 words and hardcodes
> category "general". Build `POST /api/suggest`: input `{ memory_entry_id }`; load the
> memory, build context (recent nodes + neighbors like /api/explore does), call
> `chatCompletionStructured` with a new Zod schema matching `AISuggestionPayload` in
> src/types/index.ts (action, title, summary, category, confidence, related_node_ids,
> suggested_edges, explanation). Return the validated suggestion. Then add an
> `applySuggestionAction` server action that creates the node (origin "ai_pinned"),
> links the memory entry, and creates the suggested edges, all reusing the ownership
> checks in src/lib/graph/actions.ts. Reuse the chat `SuggestionCard` UI to review and
> accept. Keep AI keys server-side, validate with Zod, never auto-apply. Run typecheck
> and lint.

> **6.2 — Add create-vs-update detection using existing embeddings**
> Extend the `/api/suggest` route from 6.1: before proposing a new node, embed the
> thought with src/lib/ai/embeddings.ts and call the `match_nodes` RPC. If the top
> match's similarity ≥ 0.8, set the suggestion action to "update_node" with that
> node's id and a merged summary; otherwise "create_node". In the review UI, clearly
> show whether the suggestion will create a new node or update an existing one (show
> the target node's title). Reuse Phase D retrieval infra; do not add dependencies.
> Run typecheck and lint.

> **6.3 — Surface un-promoted thoughts and confirm capture**
> In src/components/workspace/mind-workspace.tsx, after a thought is saved via
> ThoughtInputForm, show a transient toast "Thought saved — review suggestion" with a
> one-tap action that opens the suggestion review (from 6.1) or the Recent thoughts
> sheet. Add a small count badge to the "Recent thoughts" header button showing how
> many memory entries have no linked node (use listRecentMemoryEntries +
> listPromotedMemoryIds, already loaded in src/app/page.tsx). Keep it calm and
> unobtrusive per the UX principles. Run typecheck and lint.

> **6.4 — Implement real global search across thoughts, nodes, and documents**
> Replace the client-side substring search in mind-workspace.tsx (searchResults memo)
> with a `POST /api/search` route that runs the existing hybrid vector+keyword
> retrieval (src/lib/chat/retrieval.ts patterns, match_nodes + match_document_chunks)
> across nodes, memory_entries, and document_chunks for the signed-in user. Return
> grouped, ranked results. Update the search sheet to render grouped results (Nodes /
> Thoughts / Documents); tapping a node focuses it on the canvas, a thought opens its
> memory, a document opens its root node. Debounce input. Run typecheck and lint.

> **6.5 — Make the chat user-turn durable against AI failures**
> In src/app/api/chat/route.ts POST, the user message is only inserted after a
> successful generateChatResponse, so a 502 loses it. Reorder so the user turn is
> persisted first; if generation fails, keep the user turn, return the error with the
> conversation_id, and let the client show the failed turn with a Retry button in
> src/components/chat/chat-panel.tsx. Do not change the assistant-turn or suggestion
> persistence semantics otherwise. Run typecheck and lint.

> **6.6 — Refactor workspace state to eliminate full-page refresh on mutations**
> In MindNode, almost every mutation calls router.refresh(), causing flicker, lost
> ghost/selection state, and a full 8-query reload in src/app/page.tsx. Refactor
> src/components/workspace/mind-workspace.tsx to hold nodes and edges in useState
> seeded from props, and have the server actions in src/lib/graph/actions.ts return
> the created/updated/deleted row id(s). Apply those deltas to local state on success
> instead of calling router.refresh(); keep refresh only where a broad reload is truly
> needed (e.g. document processing completion). Preserve ghost state across mutations.
> Add optimistic UI for ghost pin (insert a pending node immediately, reconcile on
> confirm). Run typecheck and lint.

> **6.7 — Add timeouts, retries, and backoff to all AI/embedding calls**
> In src/lib/ai/provider.ts (chatCompletionJson, chatCompletionStructured) and
> src/lib/ai/embeddings.ts, wrap every fetch with an AbortController timeout
> (default 30s, configurable via env) and a bounded retry (up to 3 attempts) with
> exponential backoff on HTTP 429, 5xx, and network errors. Return the existing
> typed error results on final failure; never throw raw. Keep behavior identical on
> success. Add a brief comment explaining the policy. Run typecheck and lint.

> **6.8 — Wrap multi-step writes in transactions**
> Several MindNode flows do multiple dependent writes with no transaction, risking
> orphaned rows: chat persistence (src/app/api/chat/route.ts), document processing
> (src/lib/documents/process.ts), ghost pin (pinGhostSuggestionAction), and branch
> delete (deleteBranchAction) in src/lib/graph/actions.ts. Move each multi-step write
> into a Postgres function (SECURITY INVOKER, user-scoped via auth.uid()) called as a
> Supabase RPC, or otherwise make them atomic, so a mid-way failure rolls back. Add a
> migration under supabase/migrations/ for the new functions. Preserve all current
> ownership/RLS guarantees. Run typecheck and lint.

> **6.9 — Replace fake document upload progress with real status**
> In src/components/documents/document-upload-sheet.tsx the progress stages are a
> timed animation unrelated to server work, and large PDFs can exceed the 120s route
> cap with no feedback. Update the upload route to persist status transitions on
> source_documents (extracting → chunking → graph → processed/processed_with_warnings/
> failed) and have the sheet poll source_documents.status (via a small status endpoint
> or revalidated query) to show real progress and a final result. Remove the fake
> cycler. Keep the 10MB / type validation. Run typecheck and lint.

> **6.10 — Consistent feedback + accessibility pass on the workspace**
> In MindNode, feedback is inconsistent (some toasts, some sticky inline errors that
> never dismiss) and several controls aren't accessible. Introduce one Toast component
> for transient success/error with auto-dismiss (~5s) + manual close, and route AI,
> node-edit, edge, and chat errors through it (keep inline text only for field
> validation). Add tooltips/aria-labels to all header icon buttons in
> mind-workspace.tsx. Make ghost controls (ghost-node.tsx) and chat citations
> keyboard-operable, use the disabled attribute instead of aria-disabled, and add
> focus-trap + Escape-to-close to the bottom sheets. Run typecheck and lint.

> **6.11 — Responsive docked panels on desktop**
> MindNode uses bottom sheets everywhere, which wastes desktop space. In
> mind-workspace.tsx, keep bottom sheets below the lg breakpoint, but render the node
> detail and chat panels as a docked right-side panel on lg+ screens, leaving the
> canvas to fill the rest. Preserve all existing behavior and state. Run typecheck and
> lint.

> **6.12 — Add a test suite and wire it into CI**
> MindNode has no automated tests. Add a lightweight test runner (Vitest) and write:
> unit tests for src/lib/graph/view-model.ts, src/lib/chat/retrieval.ts tokenization
> /ranking, and src/lib/documents/chunk.ts; integration tests for the key server
> actions in src/lib/graph/actions.ts (mock Supabase); and one happy-path test of the
> capture→suggest→accept flow. Add a "test" script to package.json and a GitHub Action
> running lint, typecheck, and test on PRs. Justify the single new dev dependency.
> Run the suite.

---

## 7. Suggested sequencing

1. **Close the core promise & stop data loss/flicker:** 6.1 → 6.2 → 6.5 → 6.6, plus
   6.7 (reliability) and 6.3 (capture confirmation).
2. **Trust & speed:** 6.8 (transactions), 6.4 (search), 6.9 (honest uploads),
   6.12 (tests).
3. **Polish:** 6.10 (feedback/a11y), 6.11 (responsive), then the remaining P2 items
   (undo, insights explainers, legend, streaming chat).
</content>
</invoke>
