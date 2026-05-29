import "server-only";

import type { RetrievedContext } from "@/lib/chat/retrieval";
import type { ChatMode } from "@/types";
import type { ChatMessage } from "./provider";

const SYSTEM = `You are the reasoning companion inside MindNode, a personal source-grounded thinking system. The user is building a living graph of their life, ideas, goals, constraints, projects, and uploaded documents. You help them explore, reason through decisions, and grow that graph.

HOW TO ANSWER
- Ground every answer in the RETRIEVED CONTEXT below: the user's graph nodes, their relationships, source-document excerpts, and recent thoughts.
- When you use a source excerpt or a graph node, add it to "citations".
- If the context does not contain what you need, say so plainly and clearly mark when you are reasoning beyond the user's sources/graph (general knowledge or inference).
- Do NOT invent personal facts (names, dates, decisions, numbers) that are not in the context.
- Explain relationships between ideas when relevant. Suggest useful next branches.
- Be concise, warm, and direct. This is a personal companion, not a corporate assistant.

GROWING THE GRAPH (optional)
- When the conversation surfaces a concept, goal, constraint, or relationship that clearly belongs in the user's graph, you MAY propose graph changes in "proposed_graph_changes".
- Propose new nodes (title, summary, category, reason) and/or edges between nodes (source_title, target_title, relationship_type, reason).
- Edge titles MUST refer either to an existing node title shown in the context or to a node you propose in the same response.
- Prefer linking to existing nodes over creating near-duplicates. Only propose changes that are genuinely useful — never pad.
- relationship_type should be a short label such as: supports, conflicts_with, depends_on, evidence_for, opportunity_for, risk_to, part_of, next_step, informs, related.
- If nothing is worth adding, omit "proposed_graph_changes" entirely.

OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no prose outside JSON):
{
  "answer": "string",
  "citations": [{ "type": "source" | "node", "label": "short label", "ref": "optional" }],
  "proposed_graph_changes": {
    "nodes": [{ "title": "...", "summary": "...", "category": "...", "reason": "..." }],
    "edges": [{ "source_title": "...", "target_title": "...", "relationship_type": "...", "reason": "..." }]
  }
}`;

function describeNode(n: { title: string; summary: string; category: string }): string {
  return `- ${n.title} [${n.category}]: ${n.summary}`;
}

function buildContextBlock(ctx: RetrievedContext, mode: ChatMode): string {
  const parts: string[] = [];

  if (ctx.totalNodes === 0 && ctx.totalDocuments === 0) {
    parts.push(
      "RETRIEVED CONTEXT: The user's graph and sources are empty. Help them get started — answer warmly, and you may propose a first node or two if the message describes a concrete idea.",
    );
    return parts.join("\n\n");
  }

  if (ctx.selectedNode) {
    parts.push(
      `FOCUSED NODE — the user is asking about this node specifically:\n${describeNode(
        ctx.selectedNode,
      )}`,
    );
    if (ctx.neighborNodes.length > 0) {
      parts.push(
        `CONNECTED NODES (the focused node's neighborhood):\n${ctx.neighborNodes
          .map(describeNode)
          .join("\n")}`,
      );
    }
  }

  if (ctx.relevantNodes.length > 0) {
    parts.push(
      `RELEVANT GRAPH NODES:\n${ctx.relevantNodes.map(describeNode).join("\n")}`,
    );
  }

  if (ctx.edges.length > 0) {
    parts.push(
      `RELATIONSHIPS:\n${ctx.edges
        .map((e) => `- ${e.source_title} --[${e.relationship_type}]--> ${e.target_title}`)
        .join("\n")}`,
    );
  }

  if (ctx.chunks.length > 0) {
    parts.push(
      `SOURCE EXCERPTS (cite by filename when used):\n${ctx.chunks
        .map((c, i) => {
          const section = c.section_title ? ` · ${c.section_title}` : "";
          return `[${i + 1}] ${c.filename}${section}\n"${c.excerpt}"`;
        })
        .join("\n\n")}`,
    );
  }

  if (ctx.recentThoughts.length > 0) {
    parts.push(
      `RECENT RAW THOUGHTS (background only):\n${ctx.recentThoughts
        .map((t) => `- ${t}`)
        .join("\n")}`,
    );
  }

  if (mode === "graph_review") {
    parts.push(
      "MODE: GRAPH REVIEW. The user wants help reviewing or expanding their graph structure. Lean toward concrete proposed_graph_changes (new branches, missing links).",
    );
  }

  return parts.join("\n\n");
}

export function buildChatMessages(input: {
  message: string;
  context: RetrievedContext;
  mode: ChatMode;
  history: { role: "user" | "assistant"; content: string }[];
}): ChatMessage[] {
  const contextBlock = buildContextBlock(input.context, input.mode);

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }];

  // Prior turns for continuity (trimmed by the caller).
  for (const h of input.history) {
    messages.push({ role: h.role, content: h.content });
  }

  messages.push({
    role: "user",
    content: `${contextBlock}\n\n---\n\nUSER MESSAGE:\n${input.message}\n\nRespond with the JSON schema described in the system prompt.`,
  });

  return messages;
}
