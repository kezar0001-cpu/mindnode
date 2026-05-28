import { NextResponse } from "next/server";
import { z } from "zod";

import { generateExplorationSuggestions } from "@/lib/ai";
import { listRecentMemoryEntries } from "@/lib/memory/queries";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GraphEdge, GraphNode } from "@/types";

const explorationRequestSchema = z.object({
  selected_node_id: z.string().uuid().optional(),
  exploration_context: z
    .object({
      title: z.string().min(1).max(80),
      summary: z.string().min(1).max(500),
      category: z.string().min(1).max(40).optional(),
    })
    .optional(),
});

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonError("You must be signed in to explore.", 401);
    }

    const body = explorationRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return jsonError("Invalid exploration request.");
    }

    const supabase = await createSupabaseServerClient();

    const [{ data: nodesData, error: nodesError }, { data: edgesData, error: edgesError }] =
      await Promise.all([
        supabase
          .from("nodes")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("edges")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(80),
      ]);

    if (nodesError) {
      return jsonError("Could not load graph nodes.", 500);
    }
    if (edgesError) {
      return jsonError("Could not load graph edges.", 500);
    }

    const nodes = (nodesData ?? []) as GraphNode[];
    const edges = (edgesData ?? []) as GraphEdge[];
    const selectedNode = body.data.selected_node_id
      ? nodes.find((node) => node.id === body.data.selected_node_id)
      : undefined;

    if (body.data.selected_node_id && !selectedNode) {
      return jsonError("Selected node was not found.", 404);
    }

    const connectedIds = new Set<string>();
    if (selectedNode) {
      for (const edge of edges) {
        if (edge.source_node_id === selectedNode.id) connectedIds.add(edge.target_node_id);
        if (edge.target_node_id === selectedNode.id) connectedIds.add(edge.source_node_id);
      }
    }

    const connectedNodes = nodes.filter((node) => connectedIds.has(node.id)).slice(0, 8);
    const recentNodes = nodes
      .filter((node) => node.id !== selectedNode?.id && !connectedIds.has(node.id))
      .slice(0, 12);
    const recentMemoryEntries = await listRecentMemoryEntries(8);

    const suggestions = await generateExplorationSuggestions({
      selectedNode,
      explorationContext: body.data.exploration_context,
      connectedNodes,
      recentNodes,
      recentMemoryEntries,
    });

    return NextResponse.json(suggestions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Exploration failed.";
    const status = message.includes("AI_PROVIDER_API_KEY") ? 503 : 500;
    return jsonError(message, status);
  }
}
