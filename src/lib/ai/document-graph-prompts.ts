import "server-only";

export type GraphPromptInput = {
  filename: string;
  document_title: string;
  section_index: number;
  section_count: number;
  section_title: string;
  section_level: number;
  chunk_text: string;
  existing_node_titles: string[];
  strict?: boolean;
};

const SYSTEM = `You convert a single SECTION of a document into a fragment of a personal knowledge graph for MindNode.

YOU ARE NOT SUMMARISING. You are EXTRACTING a graph.

CORE RULES
- Output a JSON object with: section_title, section_summary, nodes[], relationships[], diagnostics.
- Every node must be grounded in the SECTION TEXT — never invent facts.
- Prefer SPECIFIC titles over generic ones. Use the exact names, roles, projects, people, and decisions present in the source.
- Bad: "Current Role". Good: "MSA Civil ABN Contractor Role".
- Bad: "Carpark Project". Good: "Depena Reserve Carpark Upgrade".
- Bad: "Aviation Plan". Good: "EASA CPL Renewal Plan".

NODE COUNT
- For a medium-to-large section, produce 3 to 10 nodes.
- A short section (under 60 words) may produce 1 to 3 nodes.
- A long section (over 600 words) may produce 8 to 15 nodes.
- DO NOT under-produce. If the section names 6 projects, create at least 6 nodes.

NODE FIELDS
- stable_key: short slug-like ID unique within this section (e.g. "msa_civil_role"). Used to wire relationships.
- title: 3-8 words, concrete and specific.
- summary: 1-3 sentences, faithful to the source.
- category: short single word (project, role, goal, task, risk, decision, contract, finance, aviation, family, health, event, constraint, evidence, general).
- node_type: one of: section, topic, fact, goal, project, person, risk, decision, task, role, event, constraint.
- importance: 0..1 — how central this is to the section.
- source_excerpt: a LITERAL quote (<=500 chars) from the section text that anchors the node.
- tags: up to 8 short tags (single words or short phrases).

RELATIONSHIPS
- Use stable_key strings ONLY (from your own nodes in this section, or "self" for none).
- relationship_type from: contains, mentions, relates_to, depends_on, supports, conflicts_with, leads_to, part_of, goal_of, risk_for, project_of, role_in, timeline_item, evidence_for, constraint_on.
- DO NOT use same_document. Use semantic types only.
- strength: 0..1.
- reason: 1 sentence anchored to the source text.

DIAGNOSTICS
- coverage_notes: 1-2 sentences explaining what you captured and what you intentionally skipped.
- omitted_content_reason: null if you captured everything important, else 1 sentence explaining what was omitted and why.

ANTI-PATTERNS
- Do not produce a single "Section Summary" node. Use multiple specific nodes.
- Do not collapse a list of 5 projects into 1 node.
- Do not invent timelines, dollar figures, names, or commitments not present.
- Do not duplicate facts across many nodes.`;

const STRICT_REMINDER = `STRICT MODE: The previous response under-produced or did not match the schema. Re-extract MORE specific nodes from the SECTION TEXT. Aim for 3-10 nodes (or more if the section warrants it). Every relationship must reference a stable_key that exists in your nodes array.`;

export function buildSectionGraphMessages(input: GraphPromptInput) {
  const titles = input.existing_node_titles.slice(0, 30);
  const titlesBlock =
    titles.length > 0 ? titles.map((t) => `- ${t}`).join("\n") : "(none yet)";

  const userParts: string[] = [];
  if (input.strict) userParts.push(STRICT_REMINDER);
  userParts.push(
    `DOCUMENT: ${input.filename}${
      input.document_title ? ` ("${input.document_title}")` : ""
    }`,
    `SECTION ${input.section_index + 1} of ${input.section_count} (level ${input.section_level})`,
    `SECTION TITLE: ${input.section_title}`,
    `EXISTING GRAPH TITLES (you may reference for cross-document relationships, but do not depend on them):\n${titlesBlock}`,
    `SECTION TEXT:\n"""\n${input.chunk_text}\n"""`,
    `Return a JSON object matching the schema, with nodes that faithfully represent this section.`,
  );

  return [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: userParts.join("\n\n") },
  ];
}
