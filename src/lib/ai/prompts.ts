import "server-only";

type GraphContextNode = { title: string; summary: string; category: string };

export type ExplorationMode = "explore" | "bridge" | "gap";

export type ExplorationPromptInput = {
  mode: ExplorationMode;
  selectedNode?: GraphContextNode;
  explorationContext?: GraphContextNode;
  rootNode?: GraphContextNode;
  bridgeAnchorA?: GraphContextNode;
  bridgeAnchorB?: GraphContextNode;
  connectedNodes: GraphContextNode[];
  recentNodes: GraphContextNode[];
  recentMemorySnippets: string[];
  visibleGhostTitles: string[];
};

const SYSTEM_BASE = `You are an exploration companion inside MindNode, a personal thought graph.

CORE RULES (always apply)
- Output ONLY valid JSON: { "suggestions": [...] }.
- No markdown. No prose outside the JSON.
- Every suggestion must be anchored. If you cannot tie a suggestion to a specific phrase in THE ANCHOR (or in the two bridge anchors when in BRIDGE mode), do not include it.
- Prefer fewer strong suggestions over many weak ones. 3 strong suggestions beat 6 generic ones.

EACH SUGGESTION FIELD
- title: 3-8 words, concrete, anchor-specific. No generic categories.
- summary: 1-2 sentences explaining the avenue.
- category: one or two words (e.g. "risk", "blocker", "evidence", "decision", "reflection", "people", "bridge_question").
- relationship_type: short label. Allowed: "related", "supports", "challenges", "depends on", "extends", "questions", "bridge_question".
- reason: 1 sentence that explicitly cites a phrase or concept FROM THE ANCHOR (or both anchors in BRIDGE mode).
- confidence: 0..1, your honest estimate of how directly this branches from the anchor. Use < 0.45 for weak ties — those will be filtered out.

ANCHOR-DRIVEN BRANCH KINDS (use these as your scaffolding)
Useful avenues for any anchor include: next steps, blockers, risks, dependencies, decisions, evidence, follow-up questions, hidden branches, structural gaps. Pick the kinds that fit the anchor — don't force all of them.

EXAMPLES (mode: explore)
ANCHOR: "I want to finish the western carpark by end of next week"

BAD titles:
- "Budget considerations"               (generic; budget isn't mentioned)
- "Post-carpark project ideas"          (drifts away)
- "Timeline for future projects"        (drifts away)
- "How this connects to work goals"     (vague)

GOOD titles:
- "What must be done before handover?"
- "Risks that could delay next week's finish"
- "Subcontractors still blocking progress"
- "Approvals needed before completion"
- "Evidence to capture before sign-off"

AVOID
- Duplicating any RECENT THOUGHTS title.
- Duplicating any VISIBLE GHOST AVENUES title.
- Empty, single-word, or pure-category titles.
- Topics not present in the anchor.`;

function describeNode(n: GraphContextNode): string {
  return `- ${n.title} [${n.category}]: ${n.summary}`;
}

function buildExploreBody(input: ExplorationPromptInput): string[] {
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
  return parts;
}

function buildBridgeBody(input: ExplorationPromptInput): string[] {
  const parts: string[] = [];
  parts.push(
    `MODE: BRIDGE. The user's graph has two thoughts that sit in separate clusters. Propose 3-5 "bridge questions" — short questions whose answers would create a meaningful link between them. relationship_type MUST be "bridge_question" for every suggestion. Each suggestion's reason must cite a phrase from BOTH anchors.`,
  );
  if (input.bridgeAnchorA) {
    parts.push(`ANCHOR A:\n${describeNode(input.bridgeAnchorA)}`);
  }
  if (input.bridgeAnchorB) {
    parts.push(`ANCHOR B:\n${describeNode(input.bridgeAnchorB)}`);
  }
  return parts;
}

function buildGapBody(input: ExplorationPromptInput): string[] {
  const parts: string[] = [];
  parts.push(
    `MODE: GAP. The user has an isolated thought with no connections in the graph. Propose 3-5 avenues that would help connect this thought to other thinking — questions, related angles, or concrete next steps that invite linkage. relationship_type should be "related" or "extends".`,
  );
  if (input.selectedNode) {
    parts.push(
      `THE ISOLATED THOUGHT — every suggestion must branch DIRECTLY from this:\n${describeNode(input.selectedNode)}`,
    );
  }
  return parts;
}

export function buildExplorationMessages(input: ExplorationPromptInput) {
  const parts: string[] = [];

  if (input.mode === "bridge") {
    parts.push(...buildBridgeBody(input));
  } else if (input.mode === "gap") {
    parts.push(...buildGapBody(input));
  } else {
    parts.push(...buildExploreBody(input));
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
      `RECENT THOUGHTS (avoid duplicating these titles):\n${input.recentNodes
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

  parts.push(
    input.mode === "bridge"
      ? `Return JSON with 3 to 5 bridge_question suggestions.`
      : input.mode === "gap"
        ? `Return JSON with 3 to 5 anchored suggestions that help link this thought to the graph.`
        : `Return JSON with 4 to 6 anchored suggestions following the schema.`,
  );

  return [
    { role: "system" as const, content: SYSTEM_BASE },
    { role: "user" as const, content: parts.join("\n\n") },
  ];
}
