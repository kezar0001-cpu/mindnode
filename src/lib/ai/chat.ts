import "server-only";

import { callJsonForTask } from "./router";
import { buildChatMessages } from "./chat-prompts";
import { ChatResponseSchema, type ChatResponse } from "./chat-schema";
import type { RetrievedContext } from "@/lib/chat/retrieval";
import type { ChatMode } from "@/types";

export type GenerateChatResult =
  | { ok: true; response: ChatResponse }
  | { ok: false; error: string };

export async function generateChatResponse(input: {
  message: string;
  context: RetrievedContext;
  mode: ChatMode;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<GenerateChatResult> {
  const messages = buildChatMessages(input);
  const result = await callJsonForTask("chat", messages);
  if (!result.ok) return { ok: false, error: result.error };

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return { ok: false, error: "AI returned invalid JSON." };
  }

  const validated = ChatResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, error: "AI output failed validation." };
  }

  return { ok: true, response: validated.data };
}
