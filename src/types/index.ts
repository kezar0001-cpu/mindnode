// Placeholder domain types for the MindNode MVP.
// Shape mirrors docs/DATA_MODEL.md and docs/AI_BEHAVIOUR.md.
// These are not yet wired to Supabase — runtime validation (Zod)
// will be added alongside the AI suggestion route in Stage 4.

export type UUID = string;

export type ISODateString = string;

export interface MemoryEntry {
  id: UUID;
  user_id: UUID;
  content: string;
  source: "chat";
  created_at: ISODateString;
}

export interface GraphNode {
  id: UUID;
  user_id: UUID;
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
  user_id: UUID;
  source_id: UUID;
  target_id: UUID;
  relation: string;
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
  user_id: UUID;
  memory_entry_id: UUID;
  action: AISuggestionAction;
  payload: AISuggestionPayload;
  status: AISuggestionStatus;
  created_at: ISODateString;
  resolved_at: ISODateString | null;
}
