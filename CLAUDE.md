# MindNode Project Instructions

MindNode is a personal-use AI memory canvas. It is not a generic note-taking app. It is a visual thinking system where unstructured ideas are captured through chat, processed by AI, and inserted into an evolving interactive graph of connected thoughts.

## Product Vision

MindNode helps the user build a living network of thoughts.

The core workflow is:

1. User types an unstructured thought, idea, memory, plan, question, or reflection.
2. AI reviews the new input together with existing graph context.
3. AI identifies where the idea belongs in the existing network.
4. AI creates or updates nodes and edges.
5. User can visually navigate the canvas like a moodboard, vision board, memory map, or mind map.
6. Each node stores the source memory trail behind it, not just a summary.

The product should feel like a personal thinking companion, not a corporate productivity tool.

## Core Concept

The app has two main interfaces:

1. **Chat / Input Panel**
   - User enters ideas in plain language.
   - Input can be messy, informal, incomplete, or fragmented.
   - AI extracts meaning, topics, relationships, and suggested graph updates.
2. **Visual Canvas**
   - Interactive graph of nodes and relationships.
   - User can pan, zoom, select nodes, inspect memory, and explore related thoughts.
   - Nodes represent concepts, goals, projects, ideas, fears, reflections, plans, apps, business ideas, family thoughts, aviation, finance, health, etc.

## MVP Scope

Build the smallest useful version first.

MVP must include:

- User can submit a thought.
- Thought is saved as a raw memory entry.
- AI can suggest:
  - title
  - summary
  - category
  - related existing node
  - whether to create a new node or update an existing node
  - suggested edges
- User can accept the AI suggestion.
- Canvas shows nodes and edges.
- Clicking a node opens:
  - node title
  - summary
  - related raw memories
  - connected nodes
- Data persists in Supabase.

Do not build advanced features before the MVP works end to end.

## Non-MVP Features

Do not implement these until specifically requested:

- Collaboration
- Public sharing
- Teams
- Payments
- Mobile native app
- Complex permission systems
- Export/import
- Advanced graph algorithms
- Multi-user organisation logic
- Full offline mode
- Plugin marketplace
- Voice input
- Image generation
- Calendar/task integrations

## Technical Stack

Use:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase
- React Flow via `@xyflow/react`
- OpenAI or another AI provider through a server-side API route
- Zod for validating AI responses
- UUIDs for database identifiers

Prefer simple, boring, maintainable code.

## Development Rules

- Keep changes small and reviewable.
- Do not rewrite large areas unless necessary.
- Do not introduce new dependencies without explaining why.
- Do not hardcode secrets.
- Do not expose AI provider keys to the client.
- Do not skip TypeScript types.
- Do not use `any` unless there is a clear reason.
- Do not create mock systems that are difficult to replace.
- Do not build features that are not in the requested task.

## Data Principles

Every AI-generated node must be traceable back to raw user input.

Never store only the AI summary. Always preserve the original user entry.

The system should distinguish between:

- raw memory entry
- processed node
- relationship/edge
- AI suggestion
- accepted graph update

## AI Behaviour

AI should not directly mutate the graph without a reviewable suggestion unless the user specifically asks for auto-apply.

AI responses must be structured and validated.

AI should return JSON in a defined schema, not loose prose.

AI should consider existing graph context before creating a new node.

AI should prefer updating or linking to existing nodes when relevant, rather than creating duplicate nodes.

## UX Principles

The app should feel calm, visual, and personal.

Avoid clutter. Avoid corporate dashboards.

The canvas should be the main experience.

The input/chat panel should feel like a natural way to unload thoughts quickly.

The node detail panel should show enough context without overwhelming the user.

## Testing and Quality

Before completing a coding task:

- Run TypeScript checks.
- Run linting.
- Run build if the change affects app structure, API routes, database logic, or dependencies.
- Explain what was changed and what was not tested.

## Working Style

When asked to implement a feature:

1. Inspect the existing files first.
2. Summarise the intended change.
3. Make the smallest practical implementation.
4. Avoid unrelated refactors.
5. Update documentation if behaviour changes.
6. Provide a clear completion summary.

## Current Priority

The current priority is initial project setup and MVP foundation, not polish.

Build in this order:

1. Project scaffold
2. Database schema
3. Basic canvas
4. Raw thought input
5. AI suggestion pipeline
6. Accept/apply graph update
7. Node detail panel
8. Basic search and retrieval
