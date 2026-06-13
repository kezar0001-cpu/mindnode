import "server-only";

import { callJsonForTask } from "./router";
import { buildChatMessages, buildProactiveMessages } from "./chat-prompts";
import { ChatResponseSchema, type ChatResponse } from "./chat-schema";
import type { RetrievedContext } from "@/lib/chat/retrieval";
import type { ChatMode } from "@/types";

export type GenerateChatResult =
  | { ok: true; response: ChatResponse }
  | { ok: false; error: string };

// Shared: run a built message array through the chat model and validate.
async function runChat(
  messages: Parameters<typeof callJsonForTask>[1],
): Promise<GenerateChatResult> {
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

// Proactive companion reaction to an on-canvas change (add/delete/etc.).
export async function generateProactiveResponse(input: {
  event: string;
  context: RetrievedContext;
}): Promise<GenerateChatResult> {
  return runChat(buildProactiveMessages(input));
}

export async function generateChatResponse(input: {
  message: string;
  context: RetrievedContext;
  mode: ChatMode;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<GenerateChatResult> {
  return runChat(buildChatMessages(input));
}
