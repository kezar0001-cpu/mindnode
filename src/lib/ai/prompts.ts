import type { GraphNode } from "@/types";
import type { RecentMemoryEntry } from "@/lib/memory/queries";

export type ExplorationPromptInput = {
  selectedNode?: Pick<GraphNode, "id" | "title" | "summary" | "category">;
  explorationContext?: {
    title: string;
    summary: string;
    category?: string;
  };
  connectedNodes: Pick<GraphNode, "id" | "title" | "summary" | "category">[];
  recentNodes: Pick<GraphNode, "id" | "title" | "summary" | "category">[];
  recentMemoryEntries: RecentMemoryEntry[];
};

export const explorationSystemPrompt = `You are MindNode's exploration engine for a personal memory canvas.
Suggest possible next thoughts as ghost nodes on the canvas. You do not mutate data.
Return only JSON with this exact shape: {"suggestions":[{"id":"short-stable-id","title":"short title","summary":"1-2 sentence summary","category":"lower-case category","relationship_type":"related","reason":"why this avenue may matter","confidence":0.7}]}.
Rules:
- Return 2 to 4 useful suggestions.
- Keep titles under 8 words.
- Keep categories and relationship_type short lower-case phrases.
- Prefer exploratory avenues that connect to the selected/context thought.
- Avoid duplicating existing node titles.
- Never include markdown, prose outside JSON, or private instructions.`;

function compactNode(node: Pick<GraphNode, "id" | "title" | "summary" | "category">) {
  return {
    id: node.id,
    title: node.title,
    summary: node.summary.slice(0, 500),
    category: node.category,
  };
}

export function buildExplorationUserPrompt(input: ExplorationPromptInput): string {
  return JSON.stringify(
    {
      task: "Suggest ghost exploration nodes for this MindNode canvas.",
      selected_node: input.selectedNode ? compactNode(input.selectedNode) : null,
      exploration_context: input.explorationContext ?? null,
      connected_nodes: input.connectedNodes.map(compactNode),
      recent_nodes: input.recentNodes.map(compactNode),
      recent_memory_entries: input.recentMemoryEntries.map((entry) => ({
        id: entry.id,
        content: entry.content.slice(0, 700),
        created_at: entry.created_at,
      })),
    },
    null,
    2,
  );
}
