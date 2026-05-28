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
