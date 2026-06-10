import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { embedText, toVectorLiteral } from "@/lib/ai/embeddings";
import { tokenize } from "@/lib/chat/retrieval";

export const dynamic = "force-dynamic";

// Global search: hybrid vector + keyword over nodes, raw memory entries, and
// document chunks. Vector search degrades cleanly to keyword-only when the
// provider or migration is unavailable — same contract as chat retrieval.

const MAX_NODES = 10;
const MAX_THOUGHTS = 8;
const MAX_DOCUMENTS = 5;
const MIN_SIMILARITY = 0.2;
const VECTOR_WEIGHT = 1.0;
const KEYWORD_WEIGHT = 0.5;

type SearchBody = { query?: string };

export type SearchNodeResult = {
  id: string;
  title: string;
  summary: string;
  category: string;
};

export type SearchThoughtResult = {
  id: string;
  content: string;
  created_at: string;
  // Set when this thought was promoted — tapping it can focus the node.
  node_id: string | null;
};

export type SearchDocumentResult = {
  document_id: string;
  filename: string;
  section_title: string | null;
  excerpt: string;
  root_node_id: string | null;
};

function overlapScore(tokens: string[], haystack: string): number {
  if (tokens.length === 0) return 0;
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (lower.includes(t)) score += 1;
  }
  return score;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const body = (await req.json().catch(() => ({}))) as SearchBody;
    const query = (body.query ?? "").trim();
    if (!query) {
      return NextResponse.json(
        { ok: false, error: "Query is required." },
        { status: 400 },
      );
    }
    if (query.length > 500) {
      return NextResponse.json(
        { ok: false, error: "Query is too long." },
        { status: 400 },
      );
    }

    const tokens = tokenize(query);
    const queryLower = query.toLowerCase();

    // Embed once; both vector searches share it. Failure → keyword-only.
    const embedded = await embedText(query);
    const vectorLiteral = embedded.ok ? toVectorLiteral(embedded.embedding) : null;

    // --- Nodes: hybrid vector + keyword ----------------------------------
    const { data: allNodes } = await supabase
      .from("nodes")
      .select("id, title, summary, category")
      .eq("user_id", user.id);
    const nodes = allNodes ?? [];

    const nodeScores = new Map<string, number>();
    for (const n of nodes) {
      const haystack = `${n.title} ${n.summary}`;
      let score = overlapScore(tokens, haystack) * KEYWORD_WEIGHT;
      // Direct phrase match outranks token overlap.
      if (haystack.toLowerCase().includes(queryLower)) score += 1;
      if (score > 0) nodeScores.set(n.id, score);
    }
    if (vectorLiteral) {
      const { data: matches } = await supabase.rpc("match_nodes", {
        query_embedding: vectorLiteral,
        match_count: MAX_NODES,
      });
      for (const m of matches ?? []) {
        if (m.similarity < MIN_SIMILARITY) continue;
        nodeScores.set(
          m.id,
          (nodeScores.get(m.id) ?? 0) + m.similarity * VECTOR_WEIGHT,
        );
      }
    }
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const rankedNodes: SearchNodeResult[] = Array.from(nodeScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NODES)
      .map(([id]) => nodeById.get(id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .map((n) => ({
        id: n.id,
        title: n.title,
        summary: n.summary,
        category: n.category,
      }));

    // --- Raw thoughts: keyword over a capped recent window ----------------
    const { data: memories } = await supabase
      .from("memory_entries")
      .select("id, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(400);

    const scoredThoughts = (memories ?? [])
      .map((m) => {
        let score = overlapScore(tokens, m.content) * KEYWORD_WEIGHT;
        if (m.content.toLowerCase().includes(queryLower)) score += 1;
        return { entry: m, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_THOUGHTS);

    // Resolve which matched thoughts already live on the canvas.
    let thoughtNodeIds = new Map<string, string>();
    if (scoredThoughts.length > 0) {
      const { data: links } = await supabase
        .from("node_memory_links")
        .select("memory_entry_id, node_id")
        .eq("user_id", user.id)
        .in(
          "memory_entry_id",
          scoredThoughts.map((s) => s.entry.id),
        );
      thoughtNodeIds = new Map(
        (links ?? []).map((l) => [l.memory_entry_id, l.node_id]),
      );
    }
    const rankedThoughts: SearchThoughtResult[] = scoredThoughts.map((s) => ({
      id: s.entry.id,
      content: s.entry.content,
      created_at: s.entry.created_at,
      node_id: thoughtNodeIds.get(s.entry.id) ?? null,
    }));

    // --- Documents: vector over chunks, deduped per document --------------
    const documentHits = new Map<
      string,
      { section_title: string | null; excerpt: string; score: number }
    >();
    if (vectorLiteral) {
      const { data: chunkMatches } = await supabase.rpc("match_document_chunks", {
        query_embedding: vectorLiteral,
        match_count: 16,
      });
      for (const c of chunkMatches ?? []) {
        if (c.similarity < MIN_SIMILARITY) continue;
        const existing = documentHits.get(c.document_id);
        if (!existing || c.similarity > existing.score) {
          documentHits.set(c.document_id, {
            section_title: c.section_title,
            excerpt: c.content.slice(0, 200),
            score: c.similarity,
          });
        }
      }
    }
    // Keyword fallback/addition over chunk content.
    if (tokens.length > 0) {
      const { data: keywordChunks } = await supabase
        .from("document_chunks")
        .select("document_id, content, section_title")
        .eq("user_id", user.id)
        .ilike("content", `%${query}%`)
        .limit(8);
      for (const c of keywordChunks ?? []) {
        if (!documentHits.has(c.document_id)) {
          documentHits.set(c.document_id, {
            section_title: c.section_title,
            excerpt: c.content.slice(0, 200),
            score: 0.5,
          });
        }
      }
    }

    let rankedDocuments: SearchDocumentResult[] = [];
    if (documentHits.size > 0) {
      const { data: docs } = await supabase
        .from("source_documents")
        .select("id, original_filename, document_root_node_id")
        .eq("user_id", user.id)
        .in("id", Array.from(documentHits.keys()));
      rankedDocuments = (docs ?? [])
        .map((d) => {
          const hit = documentHits.get(d.id)!;
          return {
            document_id: d.id,
            filename: d.original_filename,
            section_title: hit.section_title,
            excerpt: hit.excerpt,
            root_node_id: (d.document_root_node_id as string | null) ?? null,
            score: hit.score,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_DOCUMENTS)
        .map(({ score: _score, ...rest }) => rest);
    }

    return NextResponse.json({
      ok: true,
      nodes: rankedNodes,
      thoughts: rankedThoughts,
      documents: rankedDocuments,
      retrieval_mode: vectorLiteral ? "hybrid" : "keyword",
    });
  } catch (err) {
    console.error("Search route failed:", err);
    return NextResponse.json(
      { ok: false, error: "Search failed." },
      { status: 500 },
    );
  }
}
