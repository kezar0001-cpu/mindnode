"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";


type PinGhostSuggestionInput = {
  title: string;
  summary: string;
  category?: string;
  source_node_id?: string;
  relationship_type?: string;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "need",
  "that",
  "their",
  "there",
  "this",
  "want",
  "what",
  "when",
  "where",
  "with",
  "would",
  "your",
]);

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  return new Set(words);
}

function scoreKeywordOverlap(source: Set<string>, target: Set<string>): number {
  let score = 0;
  for (const word of source) {
    if (target.has(word)) score += 1;
  }
  return score;
}

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

export async function createNodeFromMemoryAction(
  memoryId: string,
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

  const { data: existingNodes } = await supabase
    .from("nodes")
    .select("id, title, summary, category")
    .eq("user_id", user.id)
    .limit(40);

  // Scatter new nodes within a 400×300 window centred at the origin.
  const position_x = (Math.random() - 0.5) * 400;
  const position_y = (Math.random() - 0.5) * 300;

  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      user_id: user.id,
      title: deriveTitle(memoryEntry.content),
      summary: memoryEntry.content,
      category: "general",
      position_x,
      position_y,
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

  const memoryKeywords = extractKeywords(memoryEntry.content);
  const relatedNodes = ((existingNodes ?? []) as Array<{
    id: string;
    title: string;
    summary: string;
    category: string;
  }>)
    .map((candidate) => ({
      id: candidate.id,
      score: scoreKeywordOverlap(
        memoryKeywords,
        extractKeywords(`${candidate.title} ${candidate.summary} ${candidate.category}`),
      ),
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (relatedNodes.length > 0) {
    const { error: edgeError } = await supabase.from("edges").insert(
      relatedNodes.map((related) => ({
        user_id: user.id,
        source_node_id: node.id,
        target_node_id: related.id,
        relationship_type: "related",
      })),
    );

    if (edgeError) {
      // Auto-connect is helpful, not required. Keep the promoted thought.
      console.error("Failed to auto-connect related manual thought:", edgeError.message);
    }
  }

  revalidatePath("/");
  return { success: true };
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
  });

  if (insertError) {
    return { success: false, error: "Could not create connection. Please try again." };
  }

  revalidatePath("/");
  return { success: true };
}


export async function pinGhostSuggestionAction(
  input: PinGhostSuggestionInput,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const title = input.title.trim();
  const summary = input.summary.trim();
  const category = input.category?.trim() || "ai exploration";
  const relationshipType = input.relationship_type?.trim() || "related";

  if (!title || !summary) {
    return { success: false, error: "Ghost suggestion needs a title and summary." };
  }

  const supabase = await createSupabaseServerClient();

  if (input.source_node_id) {
    const { data: sourceNode, error: sourceError } = await supabase
      .from("nodes")
      .select("id")
      .eq("id", input.source_node_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sourceError || !sourceNode) {
      return { success: false, error: "Source thought was not found." };
    }
  }

  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      user_id: user.id,
      title,
      summary,
      category,
      position_x: (Math.random() - 0.5) * 360,
      position_y: (Math.random() - 0.5) * 260,
    })
    .select("id")
    .single();

  if (nodeError || !node) {
    return { success: false, error: "Could not pin suggestion to the canvas." };
  }

  if (input.source_node_id && input.source_node_id !== node.id) {
    const { data: existing } = await supabase
      .from("edges")
      .select("id")
      .eq("source_node_id", input.source_node_id)
      .eq("target_node_id", node.id)
      .eq("relationship_type", relationshipType)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existing) {
      const { error: edgeError } = await supabase.from("edges").insert({
        user_id: user.id,
        source_node_id: input.source_node_id,
        target_node_id: node.id,
        relationship_type: relationshipType,
      });

      if (edgeError) {
        await supabase.from("nodes").delete().eq("id", node.id).eq("user_id", user.id);
        return { success: false, error: "Could not connect pinned suggestion." };
      }
    }
  }

  revalidatePath("/");
  return { success: true };
}
