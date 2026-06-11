import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { embedText, toVectorLiteral } from "@/lib/ai/embeddings";
import { generateCaptureSuggestion } from "@/lib/ai/suggest";
import type { SuggestCandidate } from "@/lib/ai/suggest-prompts";
import { sanitizeCaptureSuggestion } from "@/lib/ai/suggest-schema";
import { findRelatedNodesByKeywords } from "@/lib/graph/keyword-link";

export const dynamic = "force-dynamic";

const MAX_CANDIDATES = 8;

type SuggestBody = {
  memory_entry_id?: string;
};

// Builds the candidate set the AI may link to or update: vector similarity
// via match_nodes when embeddings are available, blended with keyword
// overlap so the route degrades cleanly without a provider or migration.
async function findCandidates(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  content: string,
  allNodes: { id: string; title: string; summary: string; category: string }[],
): Promise<SuggestCandidate[]> {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const candidates = new Map<string, SuggestCandidate>();

  const embedded = await embedText(content);
  if (embedded.ok) {
    const { data: matches } = await supabase.rpc("match_nodes", {
      query_embedding: toVectorLiteral(embedded.embedding),
      match_count: MAX_CANDIDATES,
    });
    for (const m of matches ?? []) {
      if (m.similarity < 0.2) continue;
      candidates.set(m.id, {
        id: m.id,
        title: m.title,
        summary: m.summary,
        category: m.category,
        similarity: m.similarity,
      });
    }
  }

  const keywordMatches = findRelatedNodesByKeywords(content, allNodes, "", 4);
  for (const k of keywordMatches) {
    if (candidates.has(k.id)) continue;
    const node = byId.get(k.id);
    if (!node) continue;
    candidates.set(k.id, {
      id: node.id,
      title: node.title,
      summary: node.summary,
      category: node.category,
    });
  }

  return Array.from(candidates.values()).slice(0, MAX_CANDIDATES);
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const body = (await req.json().catch(() => ({}))) as SuggestBody;
    const memoryEntryId = (body.memory_entry_id ?? "").trim();
    if (!memoryEntryId) {
      return NextResponse.json(
        { ok: false, error: "memory_entry_id is required." },
        { status: 400 },
      );
    }

    const { data: memoryEntry } = await supabase
      .from("memory_entries")
      .select("id, content")
      .eq("id", memoryEntryId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!memoryEntry) {
      return NextResponse.json(
        { ok: false, error: "Thought not found." },
        { status: 404 },
      );
    }

    const { data: existingLink } = await supabase
      .from("node_memory_links")
      .select("id")
      .eq("memory_entry_id", memoryEntryId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingLink) {
      return NextResponse.json(
        { ok: false, error: "already_on_canvas" },
        { status: 409 },
      );
    }

    const { data: allNodes } = await supabase
      .from("nodes")
      .select("id, title, summary, category")
      .eq("user_id", user.id);
    const nodes = allNodes ?? [];

    const candidates = await findCandidates(supabase, memoryEntry.content, nodes);
    const existingCategories = Array.from(
      new Set(nodes.map((n) => n.category).filter(Boolean)),
    ).slice(0, 24);

    const result = await generateCaptureSuggestion({
      thought: memoryEntry.content,
      candidates,
      existingCategories,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    const candidateIds = new Set(candidates.map((c) => c.id));
    const suggestion = sanitizeCaptureSuggestion(result.suggestion, candidateIds);

    // Persist as a pending suggestion so applying it is reviewable + auditable.
    const { data: stored, error: storeError } = await supabase
      .from("ai_suggestions")
      .insert({
        user_id: user.id,
        memory_entry_id: memoryEntryId,
        suggestion_json: suggestion,
        status: "pending",
      })
      .select("id")
      .single();
    if (storeError || !stored) {
      return NextResponse.json(
        { ok: false, error: "Could not store the suggestion." },
        { status: 500 },
      );
    }

    const titleById = new Map(nodes.map((n) => [n.id, n.title]));
    const targetNode = suggestion.target_node_id
      ? { id: suggestion.target_node_id, title: titleById.get(suggestion.target_node_id) ?? "Unknown" }
      : null;
    const edgeTargets = suggestion.suggested_edges.map((e) => ({
      id: e.target_node_id,
      title: titleById.get(e.target_node_id) ?? "Unknown",
      relationship_type: e.relationship_type,
    }));

    return NextResponse.json({
      ok: true,
      suggestion_id: stored.id,
      memory_entry_id: memoryEntryId,
      suggestion,
      target_node: targetNode,
      edge_targets: edgeTargets,
    });
  } catch (err) {
    console.error("Suggest route failed:", err);
    return NextResponse.json(
      { ok: false, error: "Suggestion failed." },
      { status: 500 },
    );
  }
}
