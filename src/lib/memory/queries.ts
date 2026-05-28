import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RecentMemoryEntry = {
  id: string;
  content: string;
  created_at: string;
};

export async function listRecentMemoryEntries(
  limit = 20,
): Promise<RecentMemoryEntry[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("memory_entries")
    .select("id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load memory entries: ${error.message}`);
  }

  return data ?? [];
}

// Returns the IDs of memory entries that are already linked to at least
// one node, so the UI can show "On canvas" instead of "Add to canvas".
export async function listPromotedMemoryIds(): Promise<string[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("node_memory_links")
    .select("memory_entry_id");

  return (data ?? []).map((r) => r.memory_entry_id);
}
