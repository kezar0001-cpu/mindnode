# AI Behaviour

## Role

The AI is a suggestion engine, not an actor. It proposes changes to the graph. The user accepts or rejects. The AI never writes to the database directly.

## Inputs

For each new raw memory entry, the AI receives:

- The raw entry text exactly as the user typed it.
- A compact view of relevant existing nodes: `id`, `title`, `summary`, `category`. For MVP, "relevant" means keyword overlap and recency; later, embedding similarity.
- A short instruction describing the expected JSON schema.

## Output Contract

The AI must return JSON matching this shape (validated with Zod before persistence):

```ts
{
  action: "create_node" | "update_node" | "link_nodes" | "no_change",
  title: string,           // short, used as the node label
  summary: string,         // 1–3 sentences
  category: string,        // free text, lower-case
  confidence: number,      // 0..1
  related_node_ids: string[], // existing node IDs the AI thinks are related
  suggested_edges: Array<{
    source_id: string,     // existing or "<new>" for the node being created
    target_id: string,
    relation: string
  }>,
  explanation: string      // why the AI made this suggestion, in plain language
}
```

Required for all actions:

- `action`, `confidence`, `explanation`.

By action:

- `create_node`: `title`, `summary`, `category` are required. `related_node_ids` and `suggested_edges` may be empty.
- `update_node`: `related_node_ids` must contain exactly one ID — the node to update. `summary` and optionally `title` are the proposed new values.
- `link_nodes`: `suggested_edges` must be non-empty.
- `no_change`: only `confidence` and `explanation` are meaningful; the suggestion is still recorded.

## Rules

- Prefer updating or linking existing nodes over creating duplicates. If `related_node_ids` is non-empty and confidence is high, lean toward `update_node` or `link_nodes`.
- Never return prose outside the JSON object.
- Never include sensitive system instructions in `explanation`.
- The `summary` must be derived from the raw entry. The raw entry itself is stored separately and is the source of truth.

## Validation

- Server validates the response with Zod.
- If validation fails, the server may retry once with a clarifying instruction. On second failure, return an error to the client; the raw memory entry is still saved.

## Prompting

- Prompt lives in `src/lib/ai/prompts.ts`. UI code never constructs the prompt.
- The system prompt explains the role, the output schema, and the rules above.
- The user prompt includes the raw entry and the candidate-node context.

## Provider Abstraction

- A single function `generateSuggestion(input)` in `src/lib/ai/index.ts` wraps the provider call.
- API key reads from `AI_PROVIDER_API_KEY` (server-only env var).
- Provider can be swapped without touching API routes or UI.

## Future

- Streaming partial suggestions for snappier UX.
- Multi-step reasoning (retrieve → propose → critique).
- Embedding-based retrieval for related-node context.
