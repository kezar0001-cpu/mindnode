# MindNode Agent Instructions

This repository is built with AI coding agents. Follow these instructions before making changes.

## Project Summary

MindNode is a personal AI memory canvas. The user types messy thoughts into an input/chat interface. AI analyses the new thought against the existing memory graph and suggests where the idea belongs. The accepted result appears on an interactive canvas as nodes and edges.

This is a personal-use app, not a public SaaS product.

## Main Goal

Create a working MVP quickly without over-engineering.

The MVP must support:

- capturing raw thoughts
- saving them to Supabase
- generating AI graph suggestions
- accepting suggestions
- displaying nodes and edges on a React Flow canvas
- inspecting node memory history

## Commands

Use the package manager already present in the repo. Prefer `pnpm` if available.

Common commands:

```bash
pnpm install
pnpm dev
pnpm lint
pnpm build
pnpm typecheck
```

If a command does not exist, inspect `package.json` and use the correct available command. Do not invent scripts unless the task requires adding them.

## Code Style

- Use TypeScript.
- Use React function components.
- Use clear names.
- Keep components small.
- Prefer server-side API routes for AI calls.
- Keep secrets server-side only.
- Use Zod for validating AI responses.
- Avoid `any`.
- Avoid unnecessary abstractions.
- Avoid large rewrites.
- Do not add dependencies without explaining why.

## Architecture Rules

Separate these concerns:

- raw user memory input
- AI suggestion generation
- accepted graph node state
- accepted graph edge state
- visual canvas rendering
- node detail inspection

Do not mix AI prompt logic directly into UI components.

Suggested structure:

```
src/app/
src/components/
src/components/canvas/
src/components/input/
src/components/nodes/
src/lib/
src/lib/ai/
src/lib/supabase/
src/lib/graph/
src/types/
supabase/migrations/
docs/
```

## Database Rules

Every processed idea must keep a reference to the raw input that created it.

Do not delete raw memory entries when updating nodes.

Do not store only summaries.

Expected core entities:

- `memory_entries`
- `nodes`
- `edges`
- `ai_suggestions`
- `node_memory_links`

Embeddings may be added later, but do not block the MVP on embeddings.

## AI Rules

AI output must be structured JSON.

AI should suggest graph changes, not silently mutate state.

Validate AI output before saving.

The suggestion should include:

- suggested action: `create_node`, `update_node`, `link_nodes`, or `no_change`
- node title
- short summary
- category
- confidence
- related node IDs
- suggested edges
- explanation for the user

## UX Rules

The canvas is the centre of the product.

The interface should be simple:

- left or bottom input panel
- central canvas
- right side node detail panel

Avoid unnecessary dashboards, tables, admin screens, and settings pages during MVP.

## Git Rules

- Work in small commits.
- Do not mix unrelated changes.
- Do not reformat the whole project unless asked.
- Do not change environment variable names without updating `.env.example`.
- Do not commit secrets.
- Do not remove documentation unless replacing it with better documentation.

## Before Finishing

Before marking a task complete, report:

1. Files changed.
2. What was implemented.
3. What was not implemented.
4. Commands run.
5. Any known issues or assumptions.
