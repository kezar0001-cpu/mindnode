import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Lightweight keyword/token-overlap retrieval. No embeddings — keeps the MVP
// dependency-free and good enough for a personal-scale graph. If vector search
// is added later, this module is the single place to swap the scoring.

type Supabase = SupabaseClient<Database>;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this",
  "that", "have", "has", "had", "was", "were", "what", "when", "where", "which",
  "who", "why", "how", "can", "could", "would", "should", "about", "into", "from",
  "they", "them", "their", "there", "here", "out", "all", "any", "some", "more",
  "most", "want", "need", "like", "just", "get", "got", "make", "made", "based",
  "everything", "anything", "something", "tell", "give", "show", "help",
]);

export function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  );
}

function overlapScore(tokens: string[], haystack: string): number {
  if (tokens.length === 0) return 0;
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (lower.includes(t)) score += 1;
  }
  return score;
}

export type RetrievedNode = {
  id: string;
  title: string;
  summary: string;
  category: string;
  origin: string;
};

export type RetrievedChunk = {
  document_id: string;
  filename: string;
  section_title: string | null;
  excerpt: string;
};

export type RetrievedEdge = {
  source_title: string;
  target_title: string;
  relationship_type: string;
};

export type RetrievedContext = {
  selectedNode: RetrievedNode | null;
  neighborNodes: RetrievedNode[];
  relevantNodes: RetrievedNode[];
  edges: RetrievedEdge[];
  chunks: RetrievedChunk[];
  recentThoughts: string[];
  totalNodes: number;
  totalDocuments: number;
};

const MAX_RELEVANT_NODES = 14;
const MAX_CHUNKS = 16;
const MAX_NEIGHBORS = 12;
const CHUNK_SCAN_LIMIT = 400;

export async function retrieveChatContext(
  supabase: Supabase,
  userId: string,
  opts: { query: string; selectedNodeId?: string },
): Promise<RetrievedContext> {
  const tokens = tokenize(opts.query);

  // 1. All nodes for this user (personal-scale; fine to load and score in JS).
  const { data: allNodes } = await supabase
    .from("nodes")
    .select("id, title, summary, category, origin")
    .eq("user_id", userId);

  const nodes = allNodes ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 2. Selected node + its neighborhood.
  let selectedNode: RetrievedNode | null = null;
  const neighborNodes: RetrievedNode[] = [];
  const neighborIds = new Set<string>();

  if (opts.selectedNodeId && nodeById.has(opts.selectedNodeId)) {
    selectedNode = nodeById.get(opts.selectedNodeId)!;
    const { data: nbrEdges } = await supabase
      .from("edges")
      .select("source_node_id, target_node_id")
      .eq("user_id", userId)
      .or(
        `source_node_id.eq.${opts.selectedNodeId},target_node_id.eq.${opts.selectedNodeId}`,
      );
    for (const e of nbrEdges ?? []) {
      if (e.source_node_id === opts.selectedNodeId) neighborIds.add(e.target_node_id);
      if (e.target_node_id === opts.selectedNodeId) neighborIds.add(e.source_node_id);
    }
    for (const id of neighborIds) {
      const n = nodeById.get(id);
      if (n) neighborNodes.push(n);
      if (neighborNodes.length >= MAX_NEIGHBORS) break;
    }
  }

  // 3. Rank remaining nodes by token overlap (title weighted higher).
  const excluded = new Set<string>(neighborIds);
  if (selectedNode) excluded.add(selectedNode.id);

  const scored = nodes
    .filter((n) => !excluded.has(n.id))
    .map((n) => ({
      node: n,
      score:
        overlapScore(tokens, n.title) * 3 +
        overlapScore(tokens, n.summary) +
        overlapScore(tokens, n.category) * 2,
    }));

  let relevantNodes: RetrievedNode[];
  if (tokens.length === 0) {
    // No usable query tokens — fall back to a recent slice for context.
    relevantNodes = nodes
      .filter((n) => !excluded.has(n.id))
      .slice(0, MAX_RELEVANT_NODES);
  } else {
    relevantNodes = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELEVANT_NODES)
      .map((s) => s.node);
  }

  // 4. Edges among the in-context nodes, rendered with node titles.
  const contextNodeIds = new Set<string>([
    ...(selectedNode ? [selectedNode.id] : []),
    ...neighborNodes.map((n) => n.id),
    ...relevantNodes.map((n) => n.id),
  ]);
  const edges: RetrievedEdge[] = [];
  if (contextNodeIds.size > 0) {
    const { data: edgeRows } = await supabase
      .from("edges")
      .select("source_node_id, target_node_id, relationship_type")
      .eq("user_id", userId);
    for (const e of edgeRows ?? []) {
      if (contextNodeIds.has(e.source_node_id) && contextNodeIds.has(e.target_node_id)) {
        const src = nodeById.get(e.source_node_id);
        const tgt = nodeById.get(e.target_node_id);
        if (src && tgt) {
          edges.push({
            source_title: src.title,
            target_title: tgt.title,
            relationship_type: e.relationship_type,
          });
        }
      }
    }
  }

  // 5. Source chunks — scan a recent window and score by token overlap.
  const { data: docRows } = await supabase
    .from("source_documents")
    .select("id, original_filename")
    .eq("user_id", userId);
  const filenameById = new Map(
    (docRows ?? []).map((d) => [d.id, d.original_filename]),
  );
  const totalDocuments = docRows?.length ?? 0;

  let chunks: RetrievedChunk[] = [];
  if (totalDocuments > 0) {
    let query = supabase
      .from("document_chunks")
      .select("document_id, content, section_title, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(CHUNK_SCAN_LIMIT);

    // Narrow the scan with an ILIKE OR over the strongest query tokens.
    if (tokens.length > 0) {
      const orFilter = tokens
        .slice(0, 6)
        .map((t) => `content.ilike.%${t.replace(/[%,()]/g, "")}%`)
        .join(",");
      if (orFilter) query = query.or(orFilter);
    }

    const { data: chunkRows } = await query;
    const scoredChunks = (chunkRows ?? [])
      .map((c) => ({ chunk: c, score: overlapScore(tokens, c.content) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CHUNKS);

    chunks = scoredChunks.map(({ chunk }) => ({
      document_id: chunk.document_id,
      filename: filenameById.get(chunk.document_id) ?? "document",
      section_title: chunk.section_title,
      excerpt: chunk.content.slice(0, 600),
    }));
  }

  // 6. Recent raw thoughts for background context.
  const { data: recent } = await supabase
    .from("memory_entries")
    .select("content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(6);
  const recentThoughts = (recent ?? []).map((m) => m.content.slice(0, 280));

  return {
    selectedNode: selectedNode
      ? {
          id: selectedNode.id,
          title: selectedNode.title,
          summary: selectedNode.summary,
          category: selectedNode.category,
          origin: selectedNode.origin,
        }
      : null,
    neighborNodes,
    relevantNodes,
    edges,
    chunks,
    recentThoughts,
    totalNodes: nodes.length,
    totalDocuments,
  };
}
