import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GraphNode, GraphEdge } from "@/types";

export type MemoryTrailEntry = {
  id: string;
  content: string;
  created_at: string;
};

export type MemoryTrailMap = Record<string, MemoryTrailEntry[]>;

export async function listNodes(): Promise<GraphNode[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nodes")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load nodes: ${error.message}`);
  return (data as GraphNode[]) ?? [];
}

export async function listEdges(): Promise<GraphEdge[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("edges")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load edges: ${error.message}`);
  return (data as GraphEdge[]) ?? [];
}

type LinkWithMemory = {
  node_id: string;
  memory_entries: MemoryTrailEntry | null;
};

export async function listNodeMemoryTrails(
  nodeIds: string[],
): Promise<MemoryTrailMap> {
  if (nodeIds.length === 0) return {};

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("node_memory_links")
    .select("node_id, memory_entries(id, content, created_at)")
    .in("node_id", nodeIds);

  if (error) throw new Error(`Failed to load memory trails: ${error.message}`);

  const map: MemoryTrailMap = {};
  for (const row of (data ?? []) as unknown as LinkWithMemory[]) {
    if (!row.memory_entries) continue;
    if (!map[row.node_id]) map[row.node_id] = [];
    map[row.node_id].push(row.memory_entries);
  }

  for (const nodeId of Object.keys(map)) {
    map[nodeId].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }

  return map;
}
