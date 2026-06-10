import "server-only";

import { z } from "zod";

import { callJsonForTask } from "./router";

// Maintains a rolling one-paragraph summary per conversation. The summary is
// what makes prior chats retrievable memory: retrieval feeds recent
// summaries into new conversations as long-term context.

const SummarySchema = z.object({
  summary: z.string().min(1).max(700),
});

const SYSTEM = `You maintain a rolling summary of a conversation between a user and their personal thinking companion. Merge the previous summary with the new exchange into ONE updated summary.

Rules:
- At most 400 characters.
- Capture topics discussed, decisions made, plans formed, and open questions.
- Keep concrete personal facts (goals, constraints, names of projects).
- Drop pleasantries and meta-chat.
- Output ONLY valid JSON: { "summary": "..." }`;

export async function generateConversationSummary(input: {
  previousSummary: string | null;
  userMessage: string;
  assistantAnswer: string;
}): Promise<string | null> {
  const parts: string[] = [];
  if (input.previousSummary) {
    parts.push(`PREVIOUS SUMMARY:\n${input.previousSummary.slice(0, 700)}`);
  }
  parts.push(`USER SAID:\n${input.userMessage.slice(0, 1200)}`);
  parts.push(`COMPANION ANSWERED:\n${input.assistantAnswer.slice(0, 1600)}`);
  parts.push("Return the updated JSON summary.");

  const result = await callJsonForTask("chat_summary", [
    { role: "system", content: SYSTEM },
    { role: "user", content: parts.join("\n\n") },
  ]);
  if (!result.ok) return null;

  try {
    const parsed = SummarySchema.safeParse(JSON.parse(result.content));
    if (!parsed.success) return null;
    return parsed.data.summary.slice(0, 500);
  } catch {
    return null;
  }
}
