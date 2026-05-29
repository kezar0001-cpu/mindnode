import "server-only";

import { chatCompletionJson } from "./provider";
import { buildExplorationMessages, type ExplorationPromptInput } from "./prompts";
import {
  ExplorationResponseSchema,
  type ExplorationSuggestion,
} from "./schema";

export type GenerateExplorationResult =
  | { ok: true; suggestions: ExplorationSuggestion[] }
  | { ok: false; error: string };

export type { ExplorationPromptInput };

export async function generateExplorationSuggestions(
  input: ExplorationPromptInput,
): Promise<GenerateExplorationResult> {
  const messages = buildExplorationMessages(input);
  const result = await chatCompletionJson(messages);
  if (!result.ok) return { ok: false, error: result.error };

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return { ok: false, error: "AI returned invalid JSON." };
  }

  const validated = ExplorationResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, error: "AI output failed validation." };
  }

  return { ok: true, suggestions: validated.data.suggestions };
}
