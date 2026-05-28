import "server-only";
import { z } from "zod";

export const ExplorationSuggestionSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  category: z.string().min(1).max(40),
  relationship_type: z.string().min(1).max(40),
  reason: z.string().min(1).max(280),
  confidence: z.number().min(0).max(1),
});

export type ExplorationSuggestion = z.infer<typeof ExplorationSuggestionSchema>;

export const ExplorationResponseSchema = z.object({
  suggestions: z.array(ExplorationSuggestionSchema).min(0).max(8),
});

export type ExplorationResponse = z.infer<typeof ExplorationResponseSchema>;
