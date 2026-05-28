# Product Spec

## Overview

MindNode is a personal AI memory canvas. The user pours messy, unstructured thinking into a chat-style input. AI reviews each entry against the existing memory graph and proposes how the new thought fits in — a new node, an update to an existing node, or a connection between nodes. The user reviews the suggestion, accepts it, and the visual graph evolves over time.

This is built for one user. It is not a multi-tenant SaaS.

## Goals

- Capture unstructured thought quickly, without forcing structure up front.
- Let AI do the structuring work as a suggestion, never as a silent mutation.
- Preserve every raw input forever, so each node can be traced back to its origin.
- Make the canvas the centre of the experience — a visual map of the user's thinking.

## Non-Goals

- Collaboration, sharing, teams, or multi-user logic.
- Mobile-native apps.
- Plugin marketplaces, exports, integrations.
- General-purpose note-taking.
- Replacing structured tools like task managers or calendars.

## Primary User

A single user who wants to externalise their thinking and watch it accumulate into a navigable network. Comfortable with technology. Wants the tool to feel calm and personal, not corporate.

## Primary Use Cases

1. **Brain dump.** User types whatever is on their mind. AI proposes where it fits.
2. **Reflection.** User opens the canvas, navigates clusters, re-reads old memories behind a node.
3. **Linking.** User notices two ideas are related and asks AI to link them, or AI suggests the link automatically.

## MVP Scope

- Single-user authentication (Supabase auth, simple email login).
- Raw memory entry submission.
- AI suggestion generation, returned as validated JSON.
- Suggestion review UI with accept / reject.
- Interactive canvas displaying nodes and edges (React Flow).
- Node detail panel showing summary and linked raw memory entries.
- Persistence in Supabase.

## Out of Scope (for now)

- Embeddings-based semantic search.
- Auto-clustering or layout suggestions.
- Mobile responsiveness beyond basic usability.
- Theming, customisation, or user preferences.
- Undo / history beyond raw memory preservation.

## Success Criteria

- User can submit a thought, see an AI suggestion, accept it, and watch the graph update — end to end, without errors.
- No raw input is ever lost.
- The AI always returns a structured suggestion that passes Zod validation.

## Open Questions

- Which AI provider to use first (OpenAI default, but kept abstract).
- Embedding strategy for related-node retrieval — naive keyword match for MVP, swap to embeddings later.
- Layout: free-form vs. force-directed vs. clustered. Start with React Flow defaults and iterate.
