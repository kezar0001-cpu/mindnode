import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { embedText, toVectorLiteral } from "@/lib/ai/embeddings";

// Hybrid retrieval for the chat brain: vector similarity (pgvector, via the
// match_nodes / match_document_chunks RPCs) blended with keyword/token
// overlap. Either signal can stand alone — if embeddings are unavailable
// (no key, migration not applied, embedding call fails) the keyword path
// keeps working exactly as before.

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
  document_root_node_id: string | null;
  section_title: string | null;
  excerpt: string;
};

export type RetrievedEdge = {
  source_title: string;
  target_title: string;
  relationship_type: string;
};

export type PriorConversation = {
  title: string;
  summary: string;
};

// A compact bird's-eye view of the ENTIRE graph — every node and edge in a
// terse form — so the chat always reasons over the whole neural network, not
// just the retrieved slice. Capped to stay within a sane token budget.
export type GraphMap = {
  nodeLines: string[];
  edgeLines: string[];
  truncated: boolean;
};

export type RetrievedContext = {
  selectedNode: RetrievedNode | null;
  neighborNodes: RetrievedNode[];
  relevantNodes: RetrievedNode[];
  edges: RetrievedEdge[];
  chunks: RetrievedChunk[];
  recentThoughts: string[];
  priorConversations: PriorConversation[];
  fullMap: GraphMap;
  totalNodes: number;
  totalDocuments: number;
  retrievalMode: "hybrid" | "keyword";
};

const MAX_RELEVANT_NODES = 14;
const MAX_CHUNKS = 16;
const MAX_NEIGHBORS = 12;
const MAX_PRIOR_CONVERSATIONS = 5;
// Full-network map caps — large enough for a personal graph, bounded so the
// prompt never blows the token budget on a big graph.
const MAX_MAP_NODES = 250;
const MAX_MAP_EDGES = 400;
const CHUNK_SCAN_LIMIT = 400;
const VECTOR_MATCH_COUNT = 24;
// Hybrid blend: vector similarity is the primary signal; keyword overlap
// breaks ties and rescues exact-term matches the embedding missed.
const VECTOR_WEIGHT = 1.0;
const KEYWORD_WEIGHT = 0.5;
// Below this cosine similarity a vector match is treated as noise.
const MIN_SIMILARITY = 0.25;

type ScoredId = { id: string; score: number };

function rankHybrid(
  vectorScores: Map<string, number>,
  keywordScores: Map<string, number>,
  limit: number,
): ScoredId[] {
  const maxKeyword = Math.max(1, ...keywordScores.values());
  const ids = new Set<string>([...vectorScores.keys(), ...keywordScores.keys()]);
  const scored: ScoredId[] = [];
  for (const id of ids) {
    const vec = vectorScores.get(id) ?? 0;
    const kw = (keywordScores.get(id) ?? 0) / maxKeyword;
    const score = vec * VECTOR_WEIGHT + kw * KEYWORD_WEIGHT;
    if (score > 0) scored.push({ id, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function retrieveChatContext(
  supabase: Supabase,
  userId: string,
  opts: {
    query: string;
    selectedNodeId?: string;
    excludeConversationId?: string | null;
  },
): Promise<RetrievedContext> {
  const tokens = tokenize(opts.query);

  // Embed the query once; both node and chunk vector search reuse it.
  const queryEmbedding = await embedText(opts.query).catch(
    () => ({ ok: false as const, error: "embed failed" }),
  );
  const vectorLiteral = queryEmbedding.ok
    ? toVectorLiteral(queryEmbedding.embedding)
    : null;
  let retrievalMode: "hybrid" | "keyword" = vectorLiteral ? "hybrid" : "keyword";

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

  const excluded = new Set<string>(neighborIds);
  if (selectedNode) excluded.add(selectedNode.id);

  // 3. Rank nodes — hybrid when the query embedding is available.
  const nodeKeywordScores = new Map<string, number>();
  for (const n of nodes) {
    if (excluded.has(n.id)) continue;
    const score =
      overlapScore(tokens, n.title) * 3 +
      overlapScore(tokens, n.summary) +
      overlapScore(tokens, n.category) * 2;
    if (score > 0) nodeKeywordScores.set(n.id, score);
  }

  const nodeVectorScores = new Map<string, number>();
  if (vectorLiteral) {
    const { data: matches, error } = await supabase.rpc("match_nodes", {
      query_embedding: vectorLiteral,
      match_count: VECTOR_MATCH_COUNT,
    });
    if (error) {
      // Migration not applied or function missing — degrade to keyword.
      retrievalMode = "keyword";
    } else {
      for (const m of matches ?? []) {
        if (excluded.has(m.id)) continue;
        if (m.similarity >= MIN_SIMILARITY) {
          nodeVectorScores.set(m.id, m.similarity);
        }
      }
    }
  }

  let relevantNodes: RetrievedNode[];
  const ranked = rankHybrid(nodeVectorScores, nodeKeywordScores, MAX_RELEVANT_NODES);
  if (ranked.length > 0) {
    relevantNodes = ranked
      .map((s) => nodeById.get(s.id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
  } else if (tokens.length === 0) {
    // No usable signal at all — fall back to a recent slice for context.
    relevantNodes = nodes
      .filter((n) => !excluded.has(n.id))
      .slice(0, MAX_RELEVANT_NODES);
  } else {
    relevantNodes = [];
  }

  // 4. Edges — fetched once, then used for BOTH the detailed in-context edges
  // and the compact full-network map.
  const contextNodeIds = new Set<string>([
    ...(selectedNode ? [selectedNode.id] : []),
    ...neighborNodes.map((n) => n.id),
    ...relevantNodes.map((n) => n.id),
  ]);
  const edges: RetrievedEdge[] = [];
  const allEdgeLines: string[] = [];
  let edgesTruncated = false;
  const { data: edgeRows } = await supabase
    .from("edges")
    .select("source_node_id, target_node_id, relationship_type")
    .eq("user_id", userId);
  for (const e of edgeRows ?? []) {
    const src = nodeById.get(e.source_node_id);
    const tgt = nodeById.get(e.target_node_id);
    if (!src || !tgt) continue;
    // Full-network map line (capped).
    if (allEdgeLines.length < MAX_MAP_EDGES) {
      allEdgeLines.push(`${src.title} --[${e.relationship_type}]--> ${tgt.title}`);
    } else {
      edgesTruncated = true;
    }
    // Detailed edges among the nodes already in deep context.
    if (contextNodeIds.has(e.source_node_id) && contextNodeIds.has(e.target_node_id)) {
      edges.push({
        source_title: src.title,
        target_title: tgt.title,
        relationship_type: e.relationship_type,
      });
    }
  }

  // Compact list of every node (title + category) for the full-network map.
  const nodeLines: string[] = [];
  for (const n of nodes) {
    if (nodeLines.length >= MAX_MAP_NODES) break;
    nodeLines.push(`${n.title} [${n.category || "general"}]`);
  }
  const fullMap: GraphMap = {
    nodeLines,
    edgeLines: allEdgeLines,
    truncated: edgesTruncated || nodes.length > MAX_MAP_NODES,
  };

  // 5. Source chunks — vector search first, keyword scan as complement.
  const { data: docRows } = await supabase
    .from("source_documents")
    .select("id, original_filename, document_root_node_id")
    .eq("user_id", userId);
  const docById = new Map(
    (docRows ?? []).map((d) => [
      d.id,
      {
        filename: d.original_filename,
        rootNodeId: d.document_root_node_id ?? null,
      },
    ]),
  );
  const totalDocuments = docRows?.length ?? 0;

  let chunks: RetrievedChunk[] = [];
  if (totalDocuments > 0) {
    type ChunkCandidate = {
      id: string;
      document_id: string;
      content: string;
      section_title: string | null;
    };
    const candidateById = new Map<string, ChunkCandidate>();
    const chunkVectorScores = new Map<string, number>();
    const chunkKeywordScores = new Map<string, number>();

    if (vectorLiteral && retrievalMode === "hybrid") {
      const { data: matches } = await supabase.rpc("match_document_chunks", {
        query_embedding: vectorLiteral,
        match_count: VECTOR_MATCH_COUNT,
      });
      for (const m of matches ?? []) {
        if (m.similarity < MIN_SIMILARITY) continue;
        candidateById.set(m.id, {
          id: m.id,
          document_id: m.document_id,
          content: m.content,
          section_title: m.section_title,
        });
        chunkVectorScores.set(m.id, m.similarity);
      }
    }

    if (tokens.length > 0) {
      let query = supabase
        .from("document_chunks")
        .select("id, document_id, content, section_title, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(CHUNK_SCAN_LIMIT);
      const orFilter = tokens
        .slice(0, 6)
        .map((t) => `content.ilike.%${t.replace(/[%,()]/g, "")}%`)
        .join(",");
      if (orFilter) query = query.or(orFilter);

      const { data: chunkRows } = await query;
      for (const c of chunkRows ?? []) {
        const score = overlapScore(tokens, c.content);
        if (score <= 0) continue;
        if (!candidateById.has(c.id)) {
          candidateById.set(c.id, {
            id: c.id,
            document_id: c.document_id,
            content: c.content,
            section_title: c.section_title,
          });
        }
        chunkKeywordScores.set(c.id, score);
      }
    }

    const rankedChunks = rankHybrid(chunkVectorScores, chunkKeywordScores, MAX_CHUNKS);
    chunks = rankedChunks
      .map((s) => candidateById.get(s.id))
      .filter((c): c is ChunkCandidate => Boolean(c))
      .map((chunk) => {
        const doc = docById.get(chunk.document_id);
        return {
          document_id: chunk.document_id,
          filename: doc?.filename ?? "document",
          document_root_node_id: doc?.rootNodeId ?? null,
          section_title: chunk.section_title,
          excerpt: chunk.content.slice(0, 600),
        };
      });
  }

  // 6. Recent raw thoughts for background context.
  const { data: recent } = await supabase
    .from("memory_entries")
    .select("content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(6);
  const recentThoughts = (recent ?? []).map((m) => m.content.slice(0, 280));

  // 7. Prior conversation summaries — the chat's long-term memory.
  let convQuery = supabase
    .from("chat_conversations")
    .select("id, title, summary")
    .eq("user_id", userId)
    .not("summary", "is", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_PRIOR_CONVERSATIONS);
  if (opts.excludeConversationId) {
    convQuery = convQuery.neq("id", opts.excludeConversationId);
  }
  const { data: convRows } = await convQuery;
  const priorConversations: PriorConversation[] = (convRows ?? [])
    .filter((c) => c.summary && c.summary.trim().length > 0)
    .map((c) => ({ title: c.title, summary: c.summary as string }));

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
    priorConversations,
    fullMap,
    totalNodes: nodes.length,
    totalDocuments,
    retrievalMode,
  };
}
