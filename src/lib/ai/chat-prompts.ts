import "server-only";

import type { RetrievedContext } from "@/lib/chat/retrieval";
import type { ChatMode } from "@/types";
import type { ChatMessage } from "./provider";

const SYSTEM = `You are the reasoning companion inside MindNode, a personal source-grounded thinking system. The user is building a living graph of their life, ideas, goals, constraints, projects, and uploaded documents. You help them explore, reason through decisions, and grow that graph.

HOW TO ANSWER
- Talk like a thoughtful person, not a project manager. Lead with a clear, flowing, conversational answer in prose. This is the heart of every response.
- Ground every answer in the RETRIEVED CONTEXT below: the user's graph nodes, their relationships, source-document excerpts, and recent thoughts.
- When you use a source excerpt or a graph node, add it to "citations".
- If the context does not contain what you need, say so plainly and clearly mark when you are reasoning beyond the user's sources/graph (general knowledge or inference).
- Do NOT invent personal facts (names, dates, decisions, numbers) that are not in the context.
- Explain relationships between ideas when relevant.
- Be concise, warm, and direct. This is a personal companion, not a corporate assistant.
- AVOID bullet lists, checklists, and to-do dumps unless the user explicitly asks for steps or a plan. Default to 1-3 short paragraphs of natural language.

SUGGESTING NEXT EXPLORATIONS (always)
- End every response by populating "follow_up_topics": 2-4 short, specific questions or threads the user might explore next, phrased the way THEY would ask them (e.g. "How does this connect to my aviation goals?", "What's the biggest risk here?"). Ground them in the user's actual graph and sources. These open new threads of thought, like a curious companion nudging the conversation forward. Omit only when the graph is empty and there is genuinely nothing to suggest.

GROWING THE GRAPH (optional, sparingly)
- Only when the conversation surfaces a concept, goal, constraint, or relationship that clearly belongs in the user's graph, you MAY propose graph changes in "proposed_graph_changes". This is secondary to the conversation — most replies need no changes at all. Never propose changes just to fill the field.
- Propose new nodes (title, summary, category, reason) and/or edges between nodes (source_title, target_title, relationship_type, reason).
- Edge titles MUST refer either to an existing node title shown in the context or to a node you propose in the same response.
- Prefer linking to existing nodes over creating near-duplicates. Only propose changes that are genuinely useful — never pad.
- relationship_type should be a short label such as: supports, conflicts_with, depends_on, evidence_for, opportunity_for, risk_to, part_of, next_step, informs, related.
- If nothing is worth adding, omit "proposed_graph_changes" entirely.

DEVELOPING A PLAN (plan mode)
- When MODE: PLAN is set, the user wants a concrete, staged plan they can track and act on.
- Write a short orienting answer, then express the plan AS graph changes with "is_plan": true.
- Structure: one node for the overall goal (category "goal"), then ordered step nodes (category "step"). Connect goal --[next_step]--> first step, and each step --[next_step]--> the following step. Add depends_on / risk_to / supports edges where they genuinely apply.
- 4-8 steps is ideal. Each step must be concrete and actionable (a thing the user can do), grounded in their real context and constraints. Never invent facts.
- If a useful anchor node already exists (e.g. the focused node), connect the plan to it rather than duplicating it.

REVIEWING FOR MISSED AVENUES (graph review mode)
- When MODE: GRAPH REVIEW is set, scan the retrieved graph for what the user may have missed: isolated nodes that should connect, unexplored implications, contradictions between goals and constraints, and stale branches.
- Lead with 2-4 specific observations, then propose concrete proposed_graph_changes (new connecting nodes, missing edges). Be specific to their actual graph, not generic advice.

OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no prose outside JSON):
{
  "answer": "string — conversational prose, the main reply",
  "citations": [{ "type": "source" | "node", "label": "short label", "ref": "optional" }],
  "follow_up_topics": ["short question to explore next", "another thread"],
  "proposed_graph_changes": {
    "is_plan": false,
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

  if (ctx.priorConversations.length > 0) {
    parts.push(
      `PRIOR CONVERSATIONS (summaries of earlier chats with this user — long-term memory; build on decisions and context already discussed):\n${ctx.priorConversations
        .map((c) => `- ${c.title}: ${c.summary}`)
        .join("\n")}`,
    );
  }

  if (mode === "graph_review") {
    parts.push(
      "MODE: GRAPH REVIEW. The user wants you to find missed avenues — isolated nodes, unexplored implications, contradictions, and missing links. Lead with specific observations, then propose concrete proposed_graph_changes.",
    );
  }

  if (mode === "plan") {
    parts.push(
      "MODE: PLAN. The user wants a concrete, staged, trackable plan. Return proposed_graph_changes with \"is_plan\": true — a goal node plus ordered, actionable step nodes connected with next_step edges, grounded in the context above.",
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
