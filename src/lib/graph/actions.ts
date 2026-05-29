"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findRelatedNodesByKeywords } from "./keyword-link";

export async function updateNodePositionAction(
  id: string,
  x: number,
  y: number,
): Promise<void> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("nodes")
    .update({ position_x: x, position_y: y })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    // Position persistence failure is non-critical — log and move on.
    console.error("Failed to persist node position:", error.message);
  }
}

// Derive a short node title from raw thought content.
// Takes the first ~8 words, capped at 60 characters.
function deriveTitle(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "Untitled thought";
  const words = text.split(" ");
  const short = words.slice(0, 8).join(" ");
  if (short.length <= 60) return short;
  return short.slice(0, 57) + "…";
}

function nearbyPosition(
  anchorX?: number,
  anchorY?: number,
): { position_x: number; position_y: number } {
  // If we have an anchor (focused real node), drop the new node within a
  // small radius around it so the canvas reads as a growing cluster
  // rather than scattering across the viewport.
  if (typeof anchorX === "number" && typeof anchorY === "number") {
    const angle = Math.random() * Math.PI * 2;
    const radius = 160 + Math.random() * 80;
    return {
      position_x: anchorX + Math.cos(angle) * radius,
      position_y: anchorY + Math.sin(angle) * radius,
    };
  }
  // No anchor — drop near the origin so first-time graphs cluster.
  return {
    position_x: (Math.random() - 0.5) * 280,
    position_y: (Math.random() - 0.5) * 200,
  };
}

export async function createNodeFromMemoryAction(
  memoryId: string,
  anchor?: { x: number; y: number },
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  // Fetch the memory entry, confirming it belongs to the signed-in user.
  const { data: memoryEntry, error: memoryError } = await supabase
    .from("memory_entries")
    .select("id, content")
    .eq("id", memoryId)
    .eq("user_id", user.id)
    .single();

  if (memoryError || !memoryEntry) {
    return { success: false, error: "Memory entry not found." };
  }

  // Block duplicate promotion — one node per memory entry.
  const { data: existingLink } = await supabase
    .from("node_memory_links")
    .select("id")
    .eq("memory_entry_id", memoryId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingLink) {
    return { success: false, error: "already_on_canvas" };
  }

  const { position_x, position_y } = nearbyPosition(anchor?.x, anchor?.y);

  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      user_id: user.id,
      title: deriveTitle(memoryEntry.content),
      summary: memoryEntry.content,
      category: "general",
      position_x,
      position_y,
      origin: "memory",
    })
    .select("id")
    .single();

  if (nodeError || !node) {
    return { success: false, error: "Could not create node. Please try again." };
  }

  const { error: linkError } = await supabase.from("node_memory_links").insert({
    user_id: user.id,
    node_id: node.id,
    memory_entry_id: memoryId,
  });

  if (linkError) {
    // Clean up the orphaned node so the invariant (every node ≥1 link) holds.
    await supabase.from("nodes").delete().eq("id", node.id);
    return {
      success: false,
      error: "Could not link memory to node. Please try again.",
    };
  }

  // Auto-link: find existing nodes that share keyword overlap with the raw memory.
  try {
    const { data: candidates } = await supabase
      .from("nodes")
      .select("id, title, summary")
      .eq("user_id", user.id);

    if (candidates && candidates.length > 1) {
      const related = findRelatedNodesByKeywords(
        memoryEntry.content,
        candidates as { id: string; title: string; summary: string }[],
        node.id,
      );

      if (related.length > 0) {
        // Skip pairs that already have an edge in either direction.
        const { data: existingEdges } = await supabase
          .from("edges")
          .select("source_node_id, target_node_id")
          .eq("user_id", user.id)
          .or(`source_node_id.eq.${node.id},target_node_id.eq.${node.id}`);

        const connected = new Set<string>();
        for (const e of existingEdges ?? []) {
          if (e.source_node_id === node.id) connected.add(e.target_node_id);
          if (e.target_node_id === node.id) connected.add(e.source_node_id);
        }

        const toInsert = related
          .filter((r) => !connected.has(r.id))
          .map((r) => ({
            user_id: user.id,
            source_node_id: node.id,
            target_node_id: r.id,
            relationship_type: "related",
            origin: "auto_keyword",
          }));

        if (toInsert.length > 0) {
          await supabase.from("edges").insert(toInsert);
        }
      }
    }
  } catch (err) {
    console.error("Auto-link failed:", err);
  }

  revalidatePath("/");
  return { success: true };
}

export async function pinGhostSuggestionAction(input: {
  title: string;
  summary: string;
  category: string;
  source_node_id?: string;
  relationship_type?: string;
  position_x?: number;
  position_y?: number;
  ai_reason?: string;
}): Promise<{ success: boolean; error?: string; node_id?: string }> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const title = input.title.trim().slice(0, 120);
  const summary = input.summary.trim().slice(0, 2000);
  const category = (input.category || "general").trim().slice(0, 40);

  if (!title || !summary) {
    return { success: false, error: "Title and summary are required." };
  }

  // Verify source node ownership if provided.
  if (input.source_node_id) {
    const { data: src } = await supabase
      .from("nodes")
      .select("id")
      .eq("id", input.source_node_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!src) {
      return { success: false, error: "Source thought not found." };
    }
  }

  const position_x = typeof input.position_x === "number"
    ? input.position_x
    : (Math.random() - 0.5) * 400;
  const position_y = typeof input.position_y === "number"
    ? input.position_y
    : (Math.random() - 0.5) * 300;

  const ai_reason = input.ai_reason
    ? input.ai_reason.trim().slice(0, 600)
    : null;

  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      user_id: user.id,
      title,
      summary,
      category,
      position_x,
      position_y,
      origin: "ai_pinned",
      ai_reason,
    })
    .select("id")
    .single();

  if (nodeError || !node) {
    return { success: false, error: "Could not create node." };
  }

  if (input.source_node_id && input.source_node_id !== node.id) {
    const relType = (input.relationship_type || "related").trim().slice(0, 40);
    const { error: edgeError } = await supabase.from("edges").insert({
      user_id: user.id,
      source_node_id: input.source_node_id,
      target_node_id: node.id,
      relationship_type: relType || "related",
      origin: "ai_pinned",
    });
    if (edgeError) {
      console.error("Could not create edge for pinned ghost:", edgeError.message);
      // Node was created successfully — keep it, surface a soft warning.
    }
  }

  revalidatePath("/");
  return { success: true, node_id: node.id };
}

export async function createEdgeAction(
  sourceNodeId: string,
  targetNodeId: string,
  relationshipType: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  if (sourceNodeId === targetNodeId) {
    return { success: false, error: "A thought cannot connect to itself." };
  }

  const trimmedType = relationshipType.trim() || "related";

  const supabase = await createSupabaseServerClient();

  // Verify both nodes belong to this user (RLS would block anyway, but
  // a friendly error is better than a silent insert failure).
  const { data: ownedNodes, error: ownedError } = await supabase
    .from("nodes")
    .select("id")
    .in("id", [sourceNodeId, targetNodeId])
    .eq("user_id", user.id);

  if (ownedError || !ownedNodes || ownedNodes.length !== 2) {
    return { success: false, error: "One of those thoughts wasn't found." };
  }

  // Duplicate check — same source, target, and type.
  const { data: existing } = await supabase
    .from("edges")
    .select("id")
    .eq("source_node_id", sourceNodeId)
    .eq("target_node_id", targetNodeId)
    .eq("relationship_type", trimmedType)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return { success: false, error: "These thoughts are already connected." };
  }

  const { error: insertError } = await supabase.from("edges").insert({
    user_id: user.id,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    relationship_type: trimmedType,
    origin: "manual",
  });

  if (insertError) {
    return { success: false, error: "Could not create connection. Please try again." };
  }

  revalidatePath("/");
  return { success: true };
}
