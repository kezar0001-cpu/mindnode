"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncNodeEmbeddings } from "@/lib/ai/embedding-sync";
import { CaptureSuggestionSchema } from "@/lib/ai/suggest-schema";
import type { GraphNode, GraphEdge } from "@/types";

// Explicit node columns — keeps the embedding vector out of action results.
const NODE_COLUMNS =
  "id, user_id, title, summary, category, position_x, position_y, origin, ai_reason, plan_status, created_at, updated_at";

export type ApplySuggestionResult = {
  success: boolean;
  error?: string;
  node_id?: string;
  action?: "create_node" | "update_node";
  node?: GraphNode;
  edges?: GraphEdge[];
};

function placementNear(
  anchorX?: number,
  anchorY?: number,
): { position_x: number; position_y: number } {
  if (typeof anchorX === "number" && typeof anchorY === "number") {
    const angle = Math.random() * Math.PI * 2;
    const radius = 160 + Math.random() * 80;
    return {
      position_x: anchorX + Math.cos(angle) * radius,
      position_y: anchorY + Math.sin(angle) * radius,
    };
  }
  return {
    position_x: (Math.random() - 0.5) * 280,
    position_y: (Math.random() - 0.5) * 200,
  };
}

// Applies an accepted capture suggestion: creates the proposed node (or
// updates the existing target), links the raw memory entry so the trail is
// preserved, creates the suggested edges, and marks the suggestion accepted.
export async function applyCaptureSuggestionAction(
  suggestionId: string,
): Promise<ApplySuggestionResult> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("ai_suggestions")
    .select("id, memory_entry_id, suggestion_json, status")
    .eq("id", suggestionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) {
    return { success: false, error: "Suggestion not found." };
  }
  if (row.status !== "pending") {
    return { success: false, error: "This suggestion was already decided." };
  }

  const parsed = CaptureSuggestionSchema.safeParse(row.suggestion_json);
  if (!parsed.success) {
    return { success: false, error: "Stored suggestion is invalid." };
  }
  const suggestion = parsed.data;

  // The raw memory must still exist and must not already be on the canvas.
  const { data: memoryEntry } = await supabase
    .from("memory_entries")
    .select("id")
    .eq("id", row.memory_entry_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!memoryEntry) {
    return { success: false, error: "The original thought no longer exists." };
  }
  const { data: existingLink } = await supabase
    .from("node_memory_links")
    .select("id")
    .eq("memory_entry_id", row.memory_entry_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingLink) {
    return { success: false, error: "already_on_canvas" };
  }

  let nodeId: string;
  let resultNode: GraphNode | undefined;

  if (suggestion.action === "update_node" && suggestion.target_node_id) {
    const { data: target } = await supabase
      .from("nodes")
      .select("id")
      .eq("id", suggestion.target_node_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!target) {
      return { success: false, error: "The node to update no longer exists." };
    }
    const { data: updated, error: updateError } = await supabase
      .from("nodes")
      .update({
        title: suggestion.title,
        summary: suggestion.summary,
        category: suggestion.category,
      })
      .eq("id", target.id)
      .eq("user_id", user.id)
      .select(NODE_COLUMNS)
      .single();
    if (updateError) {
      return { success: false, error: "Could not update the node." };
    }
    nodeId = target.id;
    resultNode = updated as GraphNode;
  } else {
    // Place the new node near its strongest suggested connection so the
    // canvas reads as a growing cluster.
    let anchor: { position_x: number; position_y: number } | undefined;
    const firstEdgeTarget = suggestion.suggested_edges[0]?.target_node_id;
    if (firstEdgeTarget) {
      const { data: anchorNode } = await supabase
        .from("nodes")
        .select("position_x, position_y")
        .eq("id", firstEdgeTarget)
        .eq("user_id", user.id)
        .maybeSingle();
      if (anchorNode) anchor = anchorNode;
    }
    const position = placementNear(anchor?.position_x, anchor?.position_y);

    const { data: created, error: createError } = await supabase
      .from("nodes")
      .insert({
        user_id: user.id,
        title: suggestion.title,
        summary: suggestion.summary,
        category: suggestion.category,
        position_x: position.position_x,
        position_y: position.position_y,
        origin: "memory",
        ai_reason: suggestion.explanation,
      })
      .select(NODE_COLUMNS)
      .single();
    if (createError || !created) {
      return { success: false, error: "Could not create the node." };
    }
    nodeId = created.id;
    resultNode = created as GraphNode;
  }

  const { error: linkError } = await supabase.from("node_memory_links").insert({
    user_id: user.id,
    node_id: nodeId,
    memory_entry_id: row.memory_entry_id,
  });
  if (linkError) {
    if (suggestion.action !== "update_node") {
      // Keep the invariant that every created node traces back to its memory.
      await supabase.from("nodes").delete().eq("id", nodeId).eq("user_id", user.id);
      return { success: false, error: "Could not link the thought to the node." };
    }
    // The update itself succeeded — losing the trail link is non-fatal.
    console.error("Could not link memory to updated node:", linkError.message);
  }

  // Suggested edges — ownership-checked, duplicates skipped, best-effort.
  const createdEdges: GraphEdge[] = [];
  for (const edge of suggestion.suggested_edges) {
    if (edge.target_node_id === nodeId) continue;
    const { data: owned } = await supabase
      .from("nodes")
      .select("id")
      .eq("id", edge.target_node_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!owned) continue;
    const { data: existing } = await supabase
      .from("edges")
      .select("id")
      .eq("user_id", user.id)
      .eq("source_node_id", nodeId)
      .eq("target_node_id", edge.target_node_id)
      .maybeSingle();
    if (existing) continue;
    const { data: insertedEdge } = await supabase
      .from("edges")
      .insert({
        user_id: user.id,
        source_node_id: nodeId,
        target_node_id: edge.target_node_id,
        relationship_type: edge.relationship_type.trim().slice(0, 40) || "related",
        origin: "ai_suggested",
      })
      .select("*")
      .single();
    if (insertedEdge) createdEdges.push(insertedEdge as GraphEdge);
  }

  await supabase
    .from("ai_suggestions")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", suggestionId)
    .eq("user_id", user.id);

  await syncNodeEmbeddings(supabase, user.id, { nodeIds: [nodeId] }).catch(
    (err) => console.error("Node embedding failed:", err),
  );

  revalidatePath("/");
  return {
    success: true,
    node_id: nodeId,
    action: suggestion.action,
    node: resultNode,
    edges: createdEdges,
  };
}

export async function dismissCaptureSuggestionAction(
  suggestionId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("ai_suggestions")
    .update({ status: "rejected" })
    .eq("id", suggestionId)
    .eq("user_id", user.id)
    .eq("status", "pending");

  if (error) {
    return { success: false, error: "Could not dismiss the suggestion." };
  }
  return { success: true };
}
