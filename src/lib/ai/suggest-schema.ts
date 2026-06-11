import { z } from "zod";

// Capture suggestion — the AI's proposal for where a raw thought belongs in
// the graph: a brand-new node, or an update to an existing node it clearly
// extends. Stored verbatim in ai_suggestions.suggestion_json and re-validated
// with this schema before being applied.

export const CaptureSuggestedEdgeSchema = z.object({
  target_node_id: z.string().min(1),
  relationship_type: z.string().min(1).max(40),
  reason: z.string().max(300).optional(),
});

export const CaptureSuggestionSchema = z.object({
  action: z.enum(["create_node", "update_node"]),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(2000),
  category: z.string().min(1).max(40),
  confidence: z.number().min(0).max(1),
  // Required when action is "update_node"; the route downgrades to
  // create_node if the id is missing or not among the offered candidates.
  target_node_id: z.string().nullable().optional(),
  suggested_edges: z.array(CaptureSuggestedEdgeSchema).max(4).default([]),
  explanation: z.string().min(1).max(600),
});

export type CaptureSuggestion = z.infer<typeof CaptureSuggestionSchema>;
export type CaptureSuggestedEdge = z.infer<typeof CaptureSuggestedEdgeSchema>;

// Enforce that node ids in the AI output refer to offered candidates: an
// invalid update target downgrades the action to create_node, and edges to
// unknown ids (or to the update target itself) are dropped. Pure and
// safety-critical — the model must never steer a write to a node it wasn't
// shown — so it is unit-tested directly.
export function sanitizeCaptureSuggestion(
  suggestion: CaptureSuggestion,
  candidateIds: Set<string>,
): CaptureSuggestion {
  let action = suggestion.action;
  let targetNodeId = suggestion.target_node_id ?? null;
  if (action === "update_node" && (!targetNodeId || !candidateIds.has(targetNodeId))) {
    action = "create_node";
    targetNodeId = null;
  }
  if (action === "create_node") {
    targetNodeId = null;
  }
  const suggestedEdges = suggestion.suggested_edges
    .filter((e) => candidateIds.has(e.target_node_id))
    .filter((e) => e.target_node_id !== targetNodeId)
    .slice(0, 3);
  return {
    ...suggestion,
    action,
    target_node_id: targetNodeId,
    suggested_edges: suggestedEdges,
  };
}

// What the client receives: the validated suggestion plus resolved titles for
// every node id it references, so the review UI never shows a bare uuid.
export type CaptureSuggestionResponse = {
  ok: true;
  suggestion_id: string;
  memory_entry_id: string;
  suggestion: CaptureSuggestion;
  target_node: { id: string; title: string } | null;
  edge_targets: { id: string; title: string; relationship_type: string }[];
};
