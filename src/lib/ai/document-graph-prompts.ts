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

const SYSTEM = `You are a knowledge graph extraction engine for MindNode — a personal AI knowledge graph tool.

YOUR MISSION: Extract EVERY meaningful concept, entity, fact, decision, goal, risk, task, relationship, person, organisation, metric, and date from the SECTION TEXT into a graph.

YOU ARE NOT SUMMARISING. You are EXTRACTING. Do not collapse multiple things into one node. Do not produce a 3-node summary of a 300-word section.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED OUTPUT FIELDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return a JSON object with:
  section_title      — copy the section heading
  section_summary    — 2-3 sentence overview of what this section is about
  nodes[]            — array of extracted graph nodes (see below)
  relationships[]    — edges between your nodes (see below)
  existing_links[]   — edges to nodes already in the user's existing graph (see below)
  diagnostics        — coverage notes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NODE COUNT TARGETS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scale your extraction to the content density:

  < 80 words   → 1–3 nodes
  80–200 words → 2–5 nodes
  200–500 words → 4–10 nodes
  500–800 words → 8–18 nodes
  > 800 words  → 12–25 nodes (up to 30 if content warrants)

These are MINIMUMS for content-rich sections. If a section names 6 projects, output 6 project nodes. If it lists 5 risks, output 5 risk nodes. Never collapse a list into a single vague node.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NODE FIELDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Each node requires ALL of these:

  stable_key     Slug-like ID, unique in this section. e.g. "depena_carpark_upgrade".
                 Used to wire relationships. No spaces.

  title          3–8 words. SPECIFIC and CONCRETE. Use exact names from the source.
                 ✗ Bad: "Current Role"         ✓ Good: "MSA Civil ABN Contractor"
                 ✗ Bad: "Aviation Project"     ✓ Good: "EASA CPL Renewal Pathway"
                 ✗ Bad: "Finance Goal"         ✓ Good: "Pay Off $45K Credit Card Debt"
                 ✗ Bad: "Risk Factor"          ✓ Good: "Currency Risk on Euro Income"

  summary        1–3 sentences, faithful to the source. Include specific details.

  category       One word: project, role, goal, task, risk, decision, contract,
                 finance, aviation, family, health, event, constraint, evidence,
                 concept, person, organisation, metric, date, general.

  node_type      One of: section, concept, topic, fact, goal, project, person,
                 organisation, risk, decision, task, role, event, constraint,
                 metric, date, principle.

  importance     0.0 (background detail) to 1.0 (central concept of the section).

  source_excerpt A LITERAL QUOTE (≤500 chars) from the section text that anchors this node.
                 Must appear verbatim (or near-verbatim) in the input text.

  tags           Up to 8 short tags. Single words or short phrases.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RELATIONSHIP FIELDS (between YOUR nodes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  source_key       stable_key of the source node (must exist in your nodes array)
  target_key       stable_key of the target node (must exist in your nodes array)
  relationship_type  Choose from:
                     contains, mentions, depends_on, supports, contradicts,
                     causes, part_of, leads_to, next_step, risk_for, owner_of,
                     evidence_for, constraint_on, goal_of, project_of, role_in,
                     timeline_item, same_as, blocks, enables
  reason           1 sentence anchored to the source text.
  strength         0.0–1.0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXISTING GRAPH LINKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user already has nodes in their knowledge graph (titles listed below).
If any of YOUR extracted nodes clearly relate to an EXISTING node, add an entry
to existing_links[]:

  existing_node_title   Exact title of the existing node (copy from the list)
  new_node_stable_key   Your stable_key for the new node you are linking FROM
  relationship_type     Same vocabulary as above (e.g. supports, mentions, part_of)
  reason                Why these concepts connect

Only add existing_links when the connection is meaningful and specific — not just
because they share a broad topic. Leave existing_links empty if none are relevant.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANTI-PATTERNS — NEVER DO THESE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗ Do not produce a single "Section Overview" node as the only output.
✗ Do not collapse a list of 5 items into 1 vague node.
✗ Do not use generic titles like "Key Information", "Main Points", "General Details".
✗ Do not invent facts, names, dollar amounts, or dates not in the source text.
✗ Do not duplicate facts — each concept should appear in ONE node only.
✗ Do not reference a stable_key in relationships that does not appear in your nodes[].
✗ Do not ignore the second half of a long chunk — extract from ALL of it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COVERAGE CHECKLIST (check before returning)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before returning, verify:
□ Every named person, organisation, and project has a node.
□ Every goal, task, risk, and decision mentioned has a node.
□ Every specific fact, metric, date, and constraint has a node (or is covered).
□ Every node title is specific — not generic.
□ Every relationship source_key and target_key exists in your nodes[].
□ existing_links are only added if the connection is concrete and warranted.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIAGNOSTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  coverage_notes         1–2 sentences: what you captured and why.
  omitted_content_reason null if complete; otherwise explain what was skipped.`;

const STRICT_REMINDER = `STRICT MODE RETRY: Your previous attempt under-produced or failed schema validation.

Re-read the SECTION TEXT carefully and extract MORE specific, concrete nodes.
Targets: 200–500 words → at least 4 nodes; 500+ words → at least 8 nodes.

Every relationship must reference a stable_key that EXISTS in your nodes[] array.
The existing_links[] array must be present (can be empty []).`;

export function buildSectionGraphMessages(input: GraphPromptInput) {
  const titles = input.existing_node_titles.slice(0, 80);
  const titlesBlock =
    titles.length > 0
      ? titles.map((t) => `  - ${t}`).join("\n")
      : "  (none yet)";

  const wordEstimate = input.chunk_text.trim().split(/\s+/).length;
  const sizeHint =
    wordEstimate < 80
      ? `(~${wordEstimate} words — short section, aim for 1–3 nodes)`
      : wordEstimate < 200
      ? `(~${wordEstimate} words — aim for 2–5 nodes)`
      : wordEstimate < 500
      ? `(~${wordEstimate} words — aim for 4–10 nodes)`
      : wordEstimate < 800
      ? `(~${wordEstimate} words — aim for 8–18 nodes)`
      : `(~${wordEstimate} words — aim for 12–25 nodes)`;

  const userParts: string[] = [];
  if (input.strict) userParts.push(STRICT_REMINDER);

  userParts.push(
    `DOCUMENT: "${input.filename}"${input.document_title ? ` — title: "${input.document_title}"` : ""}`,
    `SECTION: ${input.section_index + 1} of ${input.section_count} (heading level ${input.section_level})`,
    `SECTION TITLE: "${input.section_title}"`,
    `SECTION SIZE: ${sizeHint}`,
    `\nEXISTING GRAPH NODES (scan for existing_links — only link when the connection is meaningful):\n${titlesBlock}`,
    `\nSECTION TEXT:\n"""\n${input.chunk_text}\n"""`,
    `\nExtract ALL meaningful nodes and relationships. Return the full JSON object.`,
  );

  return [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: userParts.join("\n\n") },
  ];
}
