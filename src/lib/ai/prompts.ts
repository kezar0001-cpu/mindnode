import "server-only";

type GraphContextNode = { title: string; summary: string; category: string };

export type ExplorationPromptInput = {
  selectedNode?: GraphContextNode;
  explorationContext?: GraphContextNode;
  rootNode?: GraphContextNode;
  connectedNodes: GraphContextNode[];
  recentNodes: GraphContextNode[];
  recentMemorySnippets: string[];
  visibleGhostTitles: string[];
};

const SYSTEM = `You are an exploration companion inside MindNode, a personal thought graph.

YOUR JOB
Generate 4 to 6 NEW THOUGHT AVENUES that branch DIRECTLY from THE ANCHOR provided below. Each suggestion must be a direct continuation of the anchor — a more specific question, a next step, a risk, a blocker, a deeper angle, an adjacent angle, or a counter-perspective. If a suggestion cannot be tied to a specific phrase or concept in the anchor, DO NOT include it.

OUTPUT
Return ONLY valid JSON in the shape { "suggestions": [...] }. No markdown, no prose outside JSON.

EACH SUGGESTION FIELD
- title: 3-8 words. Concrete, anchor-specific. Avoid generic categories.
- summary: 1-2 sentences explaining the avenue.
- category: one or two words (e.g. "risk", "blocker", "evidence", "decision", "reflection", "people").
- relationship_type: short label ("related", "supports", "challenges", "depends on", "extends", "questions").
- reason: 1 sentence that explicitly cites a phrase or concept FROM THE ANCHOR.
- confidence: 0..1, your honest estimate of how directly this branches from the anchor. Use < 0.45 for weak ties.

EXAMPLES
Suppose THE ANCHOR is: "I want to finish the western carpark by end of next week"

BAD titles (do NOT produce these):
- "Budget considerations"               (generic; budget isn't mentioned)
- "Post-carpark project ideas"          (not a branch of THIS thought)
- "Timeline for future projects"        (drifts away from anchor)
- "How this connects to work goals"     (vague, not anchored)

GOOD titles:
- "What must be done before handover?"
- "Risks that could delay next week's finish"
- "Subcontractors still blocking progress"
- "Approvals needed before completion"
- "Evidence to capture before sign-off"

AVOID
- Duplicating any thought in RECENT THOUGHTS.
- Duplicating any title in VISIBLE GHOST AVENUES.
- Empty, single-word, or pure-category titles.
- Anything not anchored in the anchor's actual content.`;

function describeNode(n: GraphContextNode): string {
  return `- ${n.title} [${n.category}]: ${n.summary}`;
}

export function buildExplorationMessages(input: ExplorationPromptInput) {
  const parts: string[] = [];

  if (input.explorationContext) {
    parts.push(
      `THE ANCHOR — every suggestion must branch DIRECTLY from this:\n${describeNode(input.explorationContext)}`,
    );
    if (input.rootNode) {
      parts.push(
        `ROOT THOUGHT (background only — NOT the immediate anchor):\n${describeNode(input.rootNode)}`,
      );
    }
  } else if (input.selectedNode) {
    parts.push(
      `THE ANCHOR — every suggestion must branch DIRECTLY from this:\n${describeNode(input.selectedNode)}`,
    );
  } else {
    parts.push(
      `No specific anchor. Suggest open avenues across the user's graph as a whole. Each suggestion must still be specific.`,
    );
  }

  if (input.connectedNodes.length > 0) {
    parts.push(
      `CONNECTED THOUGHTS (background context, do not pivot to these):\n${input.connectedNodes
        .map(describeNode)
        .join("\n")}`,
    );
  }

  if (input.recentNodes.length > 0) {
    parts.push(
      `RECENT THOUGHTS (avoid duplicating these):\n${input.recentNodes
        .slice(0, 8)
        .map(describeNode)
        .join("\n")}`,
    );
  }

  if (input.visibleGhostTitles.length > 0) {
    parts.push(
      `VISIBLE GHOST AVENUES (avoid duplicating these):\n${input.visibleGhostTitles
        .map((t) => `- ${t}`)
        .join("\n")}`,
    );
  }

  if (input.recentMemorySnippets.length > 0) {
    parts.push(
      `RECENT RAW MEMORY (background only):\n${input.recentMemorySnippets
        .slice(0, 6)
        .map((s) => `- ${s}`)
        .join("\n")}`,
    );
  }

  parts.push(`Return JSON with 4 to 6 anchored suggestions following the schema.`);

  return [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: parts.join("\n\n") },
  ];
}
