import "server-only";
import { z } from "zod";

// Single AI-extracted note from a document chunk. The prompt anchors the
// model to a literal source_excerpt and a confidence so the pipeline can
// reason about quality without a follow-up critique pass.

export const DocumentNoteSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  category: z.string().min(1).max(40),
  source_excerpt: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  suggested_relationships: z
    .array(
      z.object({
        target_title: z.string().min(1).max(120),
        relationship_type: z.string().min(1).max(40),
        reason: z.string().min(1).max(280),
      }),
    )
    .max(5)
    .default([]),
});

export type DocumentNote = z.infer<typeof DocumentNoteSchema>;

export const DocumentNotesResponseSchema = z.object({
  notes: z.array(DocumentNoteSchema).min(0).max(8),
});

export type DocumentNotesResponse = z.infer<typeof DocumentNotesResponseSchema>;
