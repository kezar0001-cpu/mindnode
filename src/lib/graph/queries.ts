import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reconcileStaleDocuments } from "@/lib/documents/reconcile";
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
  section_count: number;
  chunk_count: number;
  nodes_created: number;
  edges_created: number;
  warnings_count: number;
  document_root_node_id: string | null;
  created_at: string;
};

export type NodeDocumentSource = {
  document_id: string;
  original_filename: string;
  source_excerpt: string | null;
  node_type: string | null;
  source_section_title: string | null;
};

export async function listSourceDocuments(): Promise<SourceDocument[]> {
  const supabase = await createSupabaseServerClient();

  // Recover any documents stuck "Working…" before reading the list, so a
  // crashed-late pipeline shows as recovered instead of perpetually working.
  await reconcileStaleDocuments(supabase).catch((err) => {
    console.error("Stale document reconciliation failed:", err);
  });

  const { data: docs, error: docsErr } = await supabase
    .from("source_documents")
    .select(
      "id, original_filename, mime_type, status, error_message, section_count, chunk_count, nodes_created, edges_created, warnings, document_root_node_id, created_at",
    )
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

  return list.map((d) => {
    const warnings = Array.isArray(d.warnings) ? d.warnings : [];
    return {
      id: d.id,
      original_filename: d.original_filename,
      mime_type: d.mime_type,
      status: d.status,
      error_message: d.error_message,
      created_at: d.created_at,
      notes_created: counts[d.id] ?? 0,
      section_count: d.section_count ?? 0,
      chunk_count: d.chunk_count ?? 0,
      nodes_created: d.nodes_created ?? 0,
      edges_created: d.edges_created ?? 0,
      warnings_count: warnings.length,
      document_root_node_id: d.document_root_node_id ?? null,
    };
  });
}

type DocumentNoteJoin = {
  node_id: string | null;
  document_id: string;
  source_excerpt: string | null;
  node_type: string | null;
  source_section_title: string | null;
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
      "node_id, document_id, source_excerpt, node_type, source_section_title, source_documents(original_filename)",
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
      node_type: row.node_type,
      source_section_title: row.source_section_title,
    };
  }
  return out;
}

// Richer per-node provenance: ai_reason from nodes + node_type + section title.
export type NodeDocumentSourceDetail = NodeDocumentSource & {
  ai_reason: string | null;
};

export async function listNodeDocumentSourceDetails(
  nodeIds: string[],
): Promise<Record<string, NodeDocumentSourceDetail>> {
  if (nodeIds.length === 0) return {};

  const supabase = await createSupabaseServerClient();
  const base = await listNodeDocumentSources(nodeIds);
  const { data: nodeRows, error } = await supabase
    .from("nodes")
    .select("id, ai_reason")
    .in("id", nodeIds);
  if (error) {
    throw new Error(`Failed to load node ai_reasons: ${error.message}`);
  }
  const reasonById = new Map<string, string | null>();
  for (const r of nodeRows ?? []) reasonById.set(r.id, r.ai_reason ?? null);

  const out: Record<string, NodeDocumentSourceDetail> = {};
  for (const [nodeId, src] of Object.entries(base)) {
    out[nodeId] = { ...src, ai_reason: reasonById.get(nodeId) ?? null };
  }
  return out;
}

// Maps every document-owned node (root, section, concept) to its document id.
// Lets the client collapse/expand a document's subtree on the canvas without
// loading the whole document graph structure.
export async function listDocumentNodeMembership(): Promise<
  Record<string, string>
> {
  const supabase = await createSupabaseServerClient();
  const out: Record<string, string> = {};

  const { data: docs } = await supabase
    .from("source_documents")
    .select("id, document_root_node_id");
  for (const d of docs ?? []) {
    if (d.document_root_node_id) out[d.document_root_node_id] = d.id;
  }

  const { data: sections } = await supabase
    .from("document_sections")
    .select("node_id, document_id")
    .not("node_id", "is", null);
  for (const s of sections ?? []) {
    if (s.node_id) out[s.node_id] = s.document_id;
  }

  const { data: notes } = await supabase
    .from("document_notes")
    .select("node_id, document_id")
    .not("node_id", "is", null);
  for (const n of notes ?? []) {
    if (n.node_id) out[n.node_id] = n.document_id;
  }

  return out;
}
