import "server-only";

import type { ChatMessage } from "./provider";

// Prompt for the capture-suggestion task: given one raw thought and the most
// related existing nodes (found via embeddings + keyword overlap), propose a
// structured node — or an update to an existing node — plus optional edges.

export type SuggestCandidate = {
  id: string;
  title: string;
  summary: string;
  category: string;
  similarity?: number;
};

export type CaptureSuggestPromptInput = {
  thought: string;
  candidates: SuggestCandidate[];
  existingCategories: string[];
};

const SYSTEM_PROMPT = `You are the structuring engine of MindNode, a personal memory canvas. The user pours messy, unstructured thoughts into the app; your job is to propose where each thought belongs in their graph of connected ideas.

You must respond with a single JSON object matching exactly this shape:
{
  "action": "create_node" | "update_node",
  "title": "short, specific title (max 120 chars)",
  "summary": "clear restatement of the thought in the user's voice (max 2000 chars)",
  "category": "one or two lowercase words",
  "confidence": 0.0-1.0,
  "target_node_id": "id of the existing node to update, or null",
  "suggested_edges": [
    { "target_node_id": "id from RELATED NODES", "relationship_type": "short verb phrase", "reason": "why (max 300 chars)" }
  ],
  "explanation": "one or two sentences on why you chose this placement (max 600 chars)"
}

Rules:
- Prefer linking to existing nodes over creating near-duplicates.
- Choose "update_node" ONLY when the thought is clearly the same topic as one of the RELATED NODES — a continuation, refinement, or new detail of it. Then target_node_id must be that node's id and summary must merge the existing summary with the new thought without losing information.
- Otherwise choose "create_node" with target_node_id null.
- suggested_edges may only reference ids listed under RELATED NODES, never the update target, and at most 3. Suggest an edge only when the relationship is real and useful, not decorative.
- Reuse one of the user's EXISTING CATEGORIES when it fits; invent a new lowercase category only when nothing fits.
- Never invent facts that are not in the thought or the provided nodes.
- Keep the tone personal and plain, never corporate.`;

export function buildCaptureSuggestMessages(
  input: CaptureSuggestPromptInput,
): ChatMessage[] {
  const lines: string[] = [];

  lines.push("THOUGHT (raw, as the user typed it):");
  lines.push(input.thought);
  lines.push("");

  if (input.candidates.length > 0) {
    lines.push("RELATED NODES (the most similar existing thoughts on the canvas):");
    for (const c of input.candidates) {
      const sim =
        typeof c.similarity === "number"
          ? ` (similarity ${c.similarity.toFixed(2)})`
          : "";
      lines.push(`- id: ${c.id}${sim}`);
      lines.push(`  title: ${c.title}`);
      lines.push(`  category: ${c.category}`);
      lines.push(`  summary: ${c.summary.slice(0, 280)}`);
    }
  } else {
    lines.push("RELATED NODES: none — the canvas has no closely related thoughts yet.");
  }
  lines.push("");

  if (input.existingCategories.length > 0) {
    lines.push(`EXISTING CATEGORIES: ${input.existingCategories.join(", ")}`);
  }

  lines.push("");
  lines.push("Respond with the JSON object only.");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}
