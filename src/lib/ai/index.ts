import "server-only";

import {
  buildExplorationUserPrompt,
  explorationSystemPrompt,
  type ExplorationPromptInput,
} from "./prompts";
import { requestExplorationSuggestions } from "./provider";
import type { ExplorationSuggestions } from "./schema";

export async function generateExplorationSuggestions(
  input: ExplorationPromptInput,
): Promise<ExplorationSuggestions> {
  return requestExplorationSuggestions([
    { role: "system", content: explorationSystemPrompt },
    { role: "user", content: buildExplorationUserPrompt(input) },
  ]);
}

export type { ExplorationSuggestion, ExplorationSuggestions } from "./schema";
