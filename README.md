# MindNode

MindNode is a personal AI memory canvas.

It allows the user to type unstructured thoughts, ideas, plans, reflections, and memories into a chat-style input. AI then analyses the new input against the existing memory graph and suggests where the idea belongs. The accepted result becomes part of an interactive visual canvas made of connected nodes.

## Purpose

MindNode is designed to help turn scattered thinking into a navigable personal knowledge network.

It is part:

- digital moodboard
- vision board
- mind map
- memory system
- AI thinking companion

## Core Workflow

1. User enters a messy thought.
2. The thought is saved as a raw memory entry.
3. AI reviews the thought against existing nodes.
4. AI suggests whether to create a new node, update an existing node, or link related nodes.
5. User accepts the suggestion.
6. The graph updates visually.
7. User can explore the canvas and inspect the memory trail behind each node.

## MVP Features

- Raw thought input
- Supabase persistence
- AI graph suggestion
- Accept suggestion flow
- Interactive canvas
- Node and edge display
- Node detail panel
- Memory history per node

## Tech Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Supabase
- React Flow (`@xyflow/react`)
- Zod
- AI provider through server-side API routes

## UI Shell

The app shell is mobile-first. On phones (the primary target) `/` is a single-column stack — header, thought input, canvas, node detail. From the `lg` breakpoint (≥1024px) the three regions sit side by side. Inputs use a ≥16px font so iOS Safari doesn't zoom on focus, and the root uses `min-h-dvh` to play nicely with the changing viewport when the Safari address bar shows or hides.

## Document ingestion

You can upload a `.txt`, `.md`, `.pdf` (text-based) or `.docx` file and the AI
will extract structured notes that become new nodes on your canvas.

- **Supported types**: `.txt`, `.md`, `.pdf` (text-based, no OCR yet), `.docx`.
  `.doc` is not supported — please convert to `.docx` first.
- **Limits**: 10MB per file; up to 250,000 characters of extracted text; up
  to 30 chunks of ~1,500 words each.
- **Storage**: files land in the `mindnode-documents` Supabase Storage bucket.
  The migration creates this bucket as **private**. If you create it manually
  in the Supabase dashboard, make sure the bucket is **not** public.
- **Provenance**: each generated node carries `origin = 'document_ai'` and
  stores its source filename plus a literal excerpt from the chunk it came
  from. Same-document nodes are auto-linked with a `same_document` edge.

## Status

- Auth + RLS in place (every row of every table belongs to a single user; per-user CRUD policies).
- Raw thought capture and persistence in place. Signed-in users can write a thought, submit it via a server action, and see their 20 most-recent entries below the form. Each entry is stored in `memory_entries` with `source: "manual"`.
- Document ingestion (txt/md/pdf/docx → chunks → AI notes → nodes/edges) in place.
- AI suggestion pipeline, React Flow canvas, node detail content: not yet started.

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the development server:

```bash
pnpm dev
```

Run linting:

```bash
pnpm lint
```

Run type checks:

```bash
pnpm typecheck
```

Run build:

```bash
pnpm build
```

## Environment Variables

Create a `.env.local` file using `.env.example` as a guide.

Required variables:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AI_PROVIDER_API_KEY=
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required for sign-in to work. `SUPABASE_SERVICE_ROLE_KEY` is server-only and used only by `src/lib/supabase/admin.ts` for admin tasks that need to bypass RLS. Never expose service role or AI provider keys to the browser.

## Auth & RLS

The app is single-user in spirit but multi-tenant at the database layer so that personal data is protected on a hosted Supabase project. Two migrations form the foundation:

1. `20260528000000_initial_schema.sql` — core MVP tables.
2. `20260528010000_add_auth_and_rls.sql` — adds `user_id` columns referencing `auth.users(id)`, enables RLS on all five core tables, and adds per-user select / insert / update / delete policies.

**Creating the first user**: there is no sign-up flow yet. Create your user via the Supabase dashboard:

1. Open your Supabase project.
2. Go to **Authentication → Users → Add user**.
3. Set email + password and tick "Auto Confirm User".
4. Visit the app and sign in at `/login` with those credentials.

The home page is protected: unauthenticated visitors are redirected to `/login`.

## Project Structure

```
src/app/                  Next.js app routes
src/components/           React components
src/components/canvas/    Graph canvas components
src/components/input/     Thought input components
src/components/nodes/     Node UI components
src/lib/                  Shared logic
src/lib/ai/               AI prompts, schemas, parsing
src/lib/graph/            Graph utility functions
src/lib/supabase/         Supabase clients and queries
src/types/                Shared TypeScript types
supabase/migrations/      Database migrations
docs/                     Product and architecture notes
```

## Build Order

1. Scaffold project.
2. Add Supabase schema.
3. Add basic React Flow canvas.
4. Add raw thought input.
5. Add AI suggestion route.
6. Add suggestion review UI.
7. Add accept/apply graph update.
8. Add node detail panel.
9. Add memory history per node.

## Product Rule

**Raw thoughts must always be preserved.**

AI summaries, nodes, and edges are derived from raw entries. They should never replace the original input.

## Documentation

Detailed product and engineering notes live in [`docs/`](./docs):

- [`PRODUCT_SPEC.md`](./docs/PRODUCT_SPEC.md) — product vision and MVP scope
- [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system architecture overview
- [`DATA_MODEL.md`](./docs/DATA_MODEL.md) — database entities and relationships
- [`AI_BEHAVIOUR.md`](./docs/AI_BEHAVIOUR.md) — AI suggestion contract
- [`ROADMAP.md`](./docs/ROADMAP.md) — staged build plan
