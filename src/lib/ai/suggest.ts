import "server-only";

import { callJsonForTask } from "./router";
import {
  buildCaptureSuggestMessages,
  type CaptureSuggestPromptInput,
} from "./suggest-prompts";
import {
  CaptureSuggestionSchema,
  type CaptureSuggestion,
} from "./suggest-schema";

export type GenerateCaptureSuggestionResult =
  | { ok: true; suggestion: CaptureSuggestion }
  | { ok: false; error: string };

export async function generateCaptureSuggestion(
  input: CaptureSuggestPromptInput,
): Promise<GenerateCaptureSuggestionResult> {
  const messages = buildCaptureSuggestMessages(input);
  const result = await callJsonForTask("capture_suggest", messages);
  if (!result.ok) return { ok: false, error: result.error };

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return { ok: false, error: "AI returned invalid JSON." };
  }

  const validated = CaptureSuggestionSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, error: "AI output failed validation." };
  }

  return { ok: true, suggestion: validated.data };
}
