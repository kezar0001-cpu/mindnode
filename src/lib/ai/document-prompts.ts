import "server-only";

export type DocumentChunkPromptInput = {
  filename: string;
  chunk_index: number;
  total_chunks: number;
  chunk_text: string;
  existing_node_titles: string[];
  // Optional stricter mode used on retry after a validation failure.
  strict?: boolean;
};

const SYSTEM_PROMPT = `You are extracting structured notes from a document into MindNode, a personal thought graph.

OUTPUT FORMAT (strict)
- Return ONLY valid JSON in this exact shape: { "notes": [ ... ] }.
- No markdown. No prose outside the JSON. No code fences.
- Between 1 and 5 notes per chunk. Skip generic boilerplate.

EACH NOTE
- title: 3-8 words, concrete, specific to this chunk. Avoid generic categories like "Introduction" or "Conclusion".
- summary: 1-3 sentences. Stay faithful to the source. DO NOT INVENT facts that are not in the chunk.
- category: short single word from this list when it fits: project, risk, design, contract, idea, task, finance, aviation, family, health, decision, evidence, general.
- source_excerpt: a short LITERAL quote (<=500 chars) copied from the chunk that anchors the note. Use the exact wording from the chunk.
- confidence: 0..1, honest estimate of how clearly the note is supported by the chunk.
- suggested_relationships: 0-3 references to EXISTING node titles from the provided list. target_title MUST match an existing title EXACTLY (case-insensitive). If no relevant existing node, return an empty array.

NEVER
- Invent facts not present in the chunk.
- Output text outside the JSON.
- Use suggested_relationships target_titles that are not in the provided list.`;

const STRICT_REMINDER = `STRICT MODE: Your previous response failed validation. Return JSON only, follow the schema exactly, and obey every length and shape constraint. Do not include any commentary, markdown, or code fences.`;

export function buildDocumentChunkMessages(input: DocumentChunkPromptInput) {
  const titles = input.existing_node_titles.slice(0, 30);
  const titlesBlock =
    titles.length > 0
      ? titles.map((t) => `- ${t}`).join("\n")
      : "(none yet)";

  const userParts: string[] = [
    `DOCUMENT: ${input.filename}`,
    `CHUNK ${input.chunk_index + 1} of ${input.total_chunks}`,
    `EXISTING NODE TITLES (for suggested_relationships targets — use EXACT strings, max 30 shown):\n${titlesBlock}`,
    `CHUNK TEXT:\n"""\n${input.chunk_text}\n"""`,
    `Return JSON: { "notes": [...] } with 1 to 5 notes that each cite a literal source_excerpt from the CHUNK TEXT.`,
  ];

  if (input.strict) {
    userParts.unshift(STRICT_REMINDER);
  }

  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userParts.join("\n\n") },
  ];
}
