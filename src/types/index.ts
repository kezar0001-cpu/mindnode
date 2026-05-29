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
  user_id: UUID;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
}

export type NodeOrigin =
  | "manual"
  | "memory"
  | "ai_pinned"
  | "imported"
  | "document_ai"
  | "document_root"
  | "document_section"
  | "chat_suggested";
export type EdgeOrigin =
  | "manual"
  | "auto_keyword"
  | "ai_pinned"
  | "ai_suggested"
  | "document_ai"
  | "document_structure"
  | "chat_suggested";

export type DocumentStatus =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "processing"
  | "processed"
  | "processed_with_warnings"
  | "failed";

export interface GraphNode {
  id: UUID;
  user_id: UUID;
  title: string;
  summary: string;
  category: string;
  position_x: number;
  position_y: number;
  origin: NodeOrigin | string;
  ai_reason: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface GraphEdge {
  id: UUID;
  user_id: UUID;
  source_node_id: UUID;
  target_node_id: UUID;
  relationship_type: string;
  label: string | null;
  strength: number;
  origin: EdgeOrigin | string;
  created_at: ISODateString;
}

export interface NodeMemoryLink {
  id: UUID;
  user_id: UUID;
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
  user_id: UUID;
  memory_entry_id: UUID;
  suggestion_json: AISuggestionPayload;
  status: AISuggestionStatus;
  created_at: ISODateString;
  accepted_at: ISODateString | null;
}

// ---------------------------------------------------------------------------
// Chat brain — conversations, messages, and proposed graph changes.
// Mirrors supabase/migrations/20260531000000_add_chat_brain.sql.
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant";

export type ChatMode = "global" | "node_focus" | "document_focus" | "graph_review";

// A single source/graph reference the AI used to ground an answer.
export interface ChatCitation {
  type: "source" | "node";
  label: string;
  ref?: string;
}

// A node the AI proposes adding to the graph. Edges reference nodes by title.
export interface ProposedNode {
  title: string;
  summary: string;
  category: string;
  reason?: string;
}

export interface ProposedEdge {
  source_title: string;
  target_title: string;
  relationship_type: string;
  reason?: string;
}

export interface ProposedGraphChanges {
  nodes: ProposedNode[];
  edges: ProposedEdge[];
}

export interface ChatMessageRecord {
  id: UUID;
  conversation_id: UUID;
  user_id: UUID;
  role: ChatRole;
  content: string;
  citations: ChatCitation[];
  created_at: ISODateString;
}
