// Domain types for the MindNode MVP.
// Shapes mirror the columns created in
// supabase/migrations/20260528000000_initial_schema.sql and the AI
// suggestion contract in docs/AI_BEHAVIOUR.md.
//
// Runtime validation (Zod) for AI output will be added with the
// suggestion route in Stage 4.

export type UUID = string;

export type ISODateString = string;

export interface MemoryEntry {
  id: UUID;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
}

export interface GraphNode {
  id: UUID;
  title: string;
  summary: string;
  category: string;
  position_x: number;
  position_y: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface GraphEdge {
  id: UUID;
  source_node_id: UUID;
  target_node_id: UUID;
  relationship_type: string;
  label: string | null;
  strength: number;
  created_at: ISODateString;
}

export interface NodeMemoryLink {
  id: UUID;
  node_id: UUID;
  memory_entry_id: UUID;
  created_at: ISODateString;
}

export type AISuggestionAction =
  | "create_node"
  | "update_node"
  | "link_nodes"
  | "no_change";

export type AISuggestionStatus = "pending" | "accepted" | "rejected";

export interface AISuggestedEdge {
  source_id: UUID | "<new>";
  target_id: UUID | "<new>";
  relation: string;
}

// The structured payload returned by the AI provider. Stored verbatim
// in ai_suggestions.suggestion_json.
export interface AISuggestionPayload {
  action: AISuggestionAction;
  title: string;
  summary: string;
  category: string;
  confidence: number;
  related_node_ids: UUID[];
  suggested_edges: AISuggestedEdge[];
  explanation: string;
}

export interface AISuggestion {
  id: UUID;
  memory_entry_id: UUID;
  suggestion_json: AISuggestionPayload;
  status: AISuggestionStatus;
  created_at: ISODateString;
  accepted_at: ISODateString | null;
}
