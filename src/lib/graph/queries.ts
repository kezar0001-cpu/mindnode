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

// -----------------------------------------------------------------------
// Document ingestion — source documents and per-node provenance lookups.
// -----------------------------------------------------------------------

export type SourceDocument = {
  id: string;
  original_filename: string;
  mime_type: string;
  status: string;
  error_message: string | null;
  notes_created: number;
  created_at: string;
};

export type NodeDocumentSource = {
  document_id: string;
  original_filename: string;
  source_excerpt: string | null;
};

export async function listSourceDocuments(): Promise<SourceDocument[]> {
  const supabase = await createSupabaseServerClient();

  const { data: docs, error: docsErr } = await supabase
    .from("source_documents")
    .select("id, original_filename, mime_type, status, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (docsErr) throw new Error(`Failed to load documents: ${docsErr.message}`);

  const list = docs ?? [];
  if (list.length === 0) return [];

  const ids = list.map((d) => d.id);
  const { data: notes } = await supabase
    .from("document_notes")
    .select("document_id")
    .in("document_id", ids);

  const counts: Record<string, number> = {};
  for (const n of notes ?? []) {
    counts[n.document_id] = (counts[n.document_id] ?? 0) + 1;
  }

  return list.map((d) => ({
    id: d.id,
    original_filename: d.original_filename,
    mime_type: d.mime_type,
    status: d.status,
    error_message: d.error_message,
    created_at: d.created_at,
    notes_created: counts[d.id] ?? 0,
  }));
}

type DocumentNoteJoin = {
  node_id: string | null;
  document_id: string;
  source_excerpt: string | null;
  source_documents: { original_filename: string } | null;
};

export async function listNodeDocumentSources(
  nodeIds: string[],
): Promise<Record<string, NodeDocumentSource>> {
  if (nodeIds.length === 0) return {};

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("document_notes")
    .select(
      "node_id, document_id, source_excerpt, source_documents(original_filename)",
    )
    .in("node_id", nodeIds);

  if (error) {
    throw new Error(`Failed to load document sources: ${error.message}`);
  }

  const out: Record<string, NodeDocumentSource> = {};
  for (const row of (data ?? []) as unknown as DocumentNoteJoin[]) {
    if (!row.node_id) continue;
    if (out[row.node_id]) continue;
    out[row.node_id] = {
      document_id: row.document_id,
      original_filename: row.source_documents?.original_filename ?? "document",
      source_excerpt: row.source_excerpt,
    };
  }
  return out;
}
