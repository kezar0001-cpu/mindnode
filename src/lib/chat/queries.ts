import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ChatCitation, ChatMessageRecord, ProposedGraphChanges } from "@/types";

type Supabase = SupabaseClient<Database>;

export type PendingSuggestion = {
  id: string;
  message_id: string | null;
  changes: ProposedGraphChanges;
  created_at: string;
};

export async function getLatestConversationId(
  supabase: Supabase,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function listMessages(
  supabase: Supabase,
  userId: string,
  conversationId: string,
  limit = 50,
): Promise<ChatMessageRecord[]> {
  const { data } = await supabase
    .from("chat_messages")
    .select("id, conversation_id, user_id, role, content, citations_json, created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    user_id: m.user_id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    citations: Array.isArray(m.citations_json)
      ? (m.citations_json as unknown as ChatCitation[])
      : [],
    created_at: m.created_at,
  }));
}

export async function listPendingSuggestions(
  supabase: Supabase,
  userId: string,
  conversationId: string,
): Promise<PendingSuggestion[]> {
  const { data } = await supabase
    .from("chat_graph_suggestions")
    .select("id, message_id, suggestion_json, created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return (data ?? []).map((s) => ({
    id: s.id,
    message_id: s.message_id,
    changes: (s.suggestion_json as unknown as ProposedGraphChanges) ?? {
      nodes: [],
      edges: [],
    },
    created_at: s.created_at,
  }));
}
