import { z } from "zod";

export const explorationSuggestionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(500),
  category: z.string().min(1).max(40),
  relationship_type: z.string().min(1).max(40),
  reason: z.string().min(1).max(300),
  confidence: z.number().min(0).max(1),
});

export const explorationSuggestionsSchema = z.object({
  suggestions: z.array(explorationSuggestionSchema).max(5),
});

export type ExplorationSuggestion = z.infer<typeof explorationSuggestionSchema>;
export type ExplorationSuggestions = z.infer<typeof explorationSuggestionsSchema>;
