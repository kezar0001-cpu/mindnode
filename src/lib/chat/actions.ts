"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProposedGraphChangesSchema } from "@/lib/ai/chat-schema";
import type { ProposedGraphChanges } from "@/types";

function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

export type ApplyChatChangesResult = {
  success: boolean;
  error?: string;
  nodesCreated?: number;
  nodesReused?: number;
  edgesCreated?: number;
};

// Applies a user-approved subset of AI-proposed graph changes. Re-validated
// server-side; every node is created under the authenticated user. Edges only
// resolve to the user's own nodes, so RLS + ownership are both enforced.
export async function applyChatGraphSuggestionAction(input: {
  suggestionId?: string;
  changes: ProposedGraphChanges;
}): Promise<ApplyChatChangesResult> {
  const user = await requireUser();

  const validated = ProposedGraphChangesSchema.safeParse(input.changes);
  if (!validated.success) {
    return { success: false, error: "Invalid graph changes." };
  }
  const changes = validated.data;

  if (changes.nodes.length === 0 && changes.edges.length === 0) {
    return { success: false, error: "Nothing to add." };
  }

  const supabase = await createSupabaseServerClient();

  // If a suggestion id is provided, verify ownership before applying.
  if (input.suggestionId) {
    const { data: owned } = await supabase
      .from("chat_graph_suggestions")
      .select("id")
      .eq("id", input.suggestionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!owned) {
      return { success: false, error: "Suggestion not found." };
    }
  }

  // Build a normalized-title -> node id map of the user's existing nodes.
  const { data: existingNodes } = await supabase
    .from("nodes")
    .select("id, title")
    .eq("user_id", user.id);

  const titleToId = new Map<string, string>();
  for (const n of existingNodes ?? []) {
    titleToId.set(normalizeTitle(n.title), n.id);
  }

  let nodesCreated = 0;
  let nodesReused = 0;

  for (const node of changes.nodes) {
    const key = normalizeTitle(node.title);
    if (!key) continue;
    if (titleToId.has(key)) {
      nodesReused += 1;
      continue;
    }
    const { data: created, error } = await supabase
      .from("nodes")
      .insert({
        user_id: user.id,
        title: node.title.trim().slice(0, 120),
        summary: node.summary.trim().slice(0, 2000),
        category: (node.category || "general").trim().slice(0, 40),
        position_x: (Math.random() - 0.5) * 400,
        position_y: (Math.random() - 0.5) * 300,
        origin: "chat_suggested",
        ai_reason: node.reason ? node.reason.trim().slice(0, 600) : null,
      })
      .select("id")
      .single();
    if (error || !created) continue;
    titleToId.set(key, created.id);
    nodesCreated += 1;
  }

  // Load existing edges once to dedupe.
  const { data: existingEdges } = await supabase
    .from("edges")
    .select("source_node_id, target_node_id, relationship_type")
    .eq("user_id", user.id);
  const edgeKey = (s: string, t: string, r: string) => `${s}|${t}|${r}`;
  const seenEdges = new Set(
    (existingEdges ?? []).map((e) =>
      edgeKey(e.source_node_id, e.target_node_id, e.relationship_type),
    ),
  );

  let edgesCreated = 0;
  const edgesToInsert: {
    user_id: string;
    source_node_id: string;
    target_node_id: string;
    relationship_type: string;
    origin: string;
  }[] = [];

  for (const edge of changes.edges) {
    const sourceId = titleToId.get(normalizeTitle(edge.source_title));
    const targetId = titleToId.get(normalizeTitle(edge.target_title));
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const relType = (edge.relationship_type || "related").trim().slice(0, 40);
    const k = edgeKey(sourceId, targetId, relType);
    if (seenEdges.has(k)) continue;
    seenEdges.add(k);
    edgesToInsert.push({
      user_id: user.id,
      source_node_id: sourceId,
      target_node_id: targetId,
      relationship_type: relType,
      origin: "chat_suggested",
    });
  }

  if (edgesToInsert.length > 0) {
    const { data: inserted } = await supabase
      .from("edges")
      .insert(edgesToInsert)
      .select("id");
    edgesCreated = inserted?.length ?? 0;
  }

  if (input.suggestionId) {
    await supabase
      .from("chat_graph_suggestions")
      .update({ status: "applied", applied_at: new Date().toISOString() })
      .eq("id", input.suggestionId)
      .eq("user_id", user.id);
  }

  revalidatePath("/");
  return { success: true, nodesCreated, nodesReused, edgesCreated };
}

export async function dismissChatGraphSuggestionAction(
  suggestionId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("chat_graph_suggestions")
    .update({ status: "dismissed" })
    .eq("id", suggestionId)
    .eq("user_id", user.id);

  if (error) {
    return { success: false, error: "Could not dismiss suggestion." };
  }
  return { success: true };
}
