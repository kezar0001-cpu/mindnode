import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateExplorationSuggestions } from "@/lib/ai";
import type { ExplorationPromptInput } from "@/lib/ai/prompts";
import type { ExplorationSuggestion } from "@/lib/ai/schema";

export const dynamic = "force-dynamic";

type ExploreBody = {
  selected_node_id?: string;
  exploration_context?: {
    ghost_id?: string;
    title: string;
    summary: string;
    category?: string;
    parent_ghost_id?: string;
    root_node_id?: string;
  };
  visible_ghost_titles?: string[];
};

const MIN_CONFIDENCE = 0.45;

function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

function filterSuggestions(
  raw: ExplorationSuggestion[],
  existingTitles: Set<string>,
  visibleGhostTitles: Set<string>,
): ExplorationSuggestion[] {
  const seen = new Set<string>();
  const out: ExplorationSuggestion[] = [];
  for (const s of raw) {
    if (s.confidence < MIN_CONFIDENCE) continue;
    const key = normalizeTitle(s.title);
    if (!key || key.split(" ").length < 2) continue;
    if (seen.has(key)) continue;
    if (existingTitles.has(key)) continue;
    if (visibleGhostTitles.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const body = (await req.json().catch(() => ({}))) as ExploreBody;

    const promptInput: ExplorationPromptInput = {
      connectedNodes: [],
      recentNodes: [],
      recentMemorySnippets: [],
      visibleGhostTitles: (body.visible_ghost_titles ?? [])
        .map((t) => normalizeTitle(t))
        .filter(Boolean),
    };

    // Immediate anchor: ghost takes precedence over real node.
    if (body.exploration_context) {
      promptInput.explorationContext = {
        title: body.exploration_context.title,
        summary: body.exploration_context.summary,
        category: body.exploration_context.category || "general",
      };

      // Root real node, fetched as background context only.
      if (body.exploration_context.root_node_id) {
        const { data: root } = await supabase
          .from("nodes")
          .select("id, title, summary, category")
          .eq("id", body.exploration_context.root_node_id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (root) {
          promptInput.rootNode = {
            title: root.title,
            summary: root.summary,
            category: root.category,
          };
        }
      }
    } else if (body.selected_node_id) {
      const { data: selected } = await supabase
        .from("nodes")
        .select("id, title, summary, category")
        .eq("id", body.selected_node_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (selected) {
        promptInput.selectedNode = {
          title: selected.title,
          summary: selected.summary,
          category: selected.category,
        };

        const { data: edges } = await supabase
          .from("edges")
          .select("source_node_id, target_node_id")
          .eq("user_id", user.id)
          .or(`source_node_id.eq.${selected.id},target_node_id.eq.${selected.id}`);

        const neighborIds = new Set<string>();
        for (const e of edges ?? []) {
          if (e.source_node_id === selected.id) neighborIds.add(e.target_node_id);
          if (e.target_node_id === selected.id) neighborIds.add(e.source_node_id);
        }

        if (neighborIds.size > 0) {
          const { data: neighbors } = await supabase
            .from("nodes")
            .select("title, summary, category")
            .in("id", Array.from(neighborIds))
            .eq("user_id", user.id);
          promptInput.connectedNodes = neighbors ?? [];
        }
      }
    }

    const { data: recent } = await supabase
      .from("nodes")
      .select("id, title, summary, category")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8);
    const recentNodes = recent ?? [];
    promptInput.recentNodes = recentNodes.map((n) => ({
      title: n.title,
      summary: n.summary,
      category: n.category,
    }));

    const { data: memory } = await supabase
      .from("memory_entries")
      .select("content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(6);
    promptInput.recentMemorySnippets = (memory ?? []).map((m) => m.content.slice(0, 240));

    const result = await generateExplorationSuggestions(promptInput);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    const existingTitles = new Set(recentNodes.map((n) => normalizeTitle(n.title)));
    const visibleGhostSet = new Set(promptInput.visibleGhostTitles);
    const filtered = filterSuggestions(result.suggestions, existingTitles, visibleGhostSet);

    return NextResponse.json({ ok: true, suggestions: filtered });
  } catch (err) {
    console.error("Explore route failed:", err);
    return NextResponse.json({ ok: false, error: "Exploration failed." }, { status: 500 });
  }
}
