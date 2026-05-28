"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

export async function createNodeFromMemoryAction(
  memoryId: string,
  title: string,
  category: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  // Confirm the memory entry belongs to the signed-in user.
  const { data: memoryEntry, error: memoryError } = await supabase
    .from("memory_entries")
    .select("id")
    .eq("id", memoryId)
    .eq("user_id", user.id)
    .single();

  if (memoryError || !memoryEntry) {
    return { success: false, error: "Memory entry not found." };
  }

  const trimmedTitle = title.trim();
  const trimmedCategory = category.trim() || "general";

  if (!trimmedTitle) {
    return { success: false, error: "Title is required." };
  }

  // Scatter new nodes in a 400×300 window centred at the canvas origin.
  const position_x = (Math.random() - 0.5) * 400;
  const position_y = (Math.random() - 0.5) * 300;

  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      user_id: user.id,
      title: trimmedTitle,
      summary: "",
      category: trimmedCategory,
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
    // Clean up the orphaned node so the DB invariant (every node has ≥1 link) holds.
    await supabase.from("nodes").delete().eq("id", node.id);
    return {
      success: false,
      error: "Could not link memory to node. Please try again.",
    };
  }

  revalidatePath("/");
  return { success: true };
}
