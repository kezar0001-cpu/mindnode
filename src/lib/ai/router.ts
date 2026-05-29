import "server-only";

import { modelForTask, type AiTask } from "./models";
import {
  chatCompletionJson,
  chatCompletionStructured,
  type ChatMessage,
} from "./provider";

export type StructuredAiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type JsonAiResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export async function callJsonForTask(
  task: AiTask,
  messages: ChatMessage[],
): Promise<JsonAiResult> {
  const model = modelForTask(task);
  return chatCompletionJson(messages, model);
}

export async function callStructuredForTask<T>(
  task: AiTask,
  messages: ChatMessage[],
  schema: { name: string; jsonSchema: Record<string, unknown> },
  parse: (raw: unknown) => StructuredAiResult<T>,
): Promise<StructuredAiResult<T>> {
  const model = modelForTask(task);
  const res = await chatCompletionStructured(messages, schema, model);
  if (!res.ok) return { ok: false, error: res.error };
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.content);
  } catch {
    return { ok: false, error: "Invalid JSON from structured output." };
  }
  return parse(parsed);
}
