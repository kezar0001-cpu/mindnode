import "server-only";
import { z } from "zod";

// The structured JSON contract the chat model must return. Kept permissive
// on optional fields so a missing proposed_graph_changes block never breaks
// a perfectly good answer.

export const ChatCitationSchema = z.object({
  type: z.enum(["source", "node"]),
  label: z.string().min(1).max(200),
  ref: z.string().max(200).optional(),
});

export const ProposedNodeSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  category: z.string().min(1).max(40),
  reason: z.string().max(400).optional(),
});

export const ProposedEdgeSchema = z.object({
  source_title: z.string().min(1).max(120),
  target_title: z.string().min(1).max(120),
  relationship_type: z.string().min(1).max(40),
  reason: z.string().max(400).optional(),
});

export const ProposedGraphChangesSchema = z.object({
  nodes: z.array(ProposedNodeSchema).max(8).default([]),
  edges: z.array(ProposedEdgeSchema).max(12).default([]),
});

export const ChatResponseSchema = z.object({
  answer: z.string().min(1).max(6000),
  citations: z.array(ChatCitationSchema).max(20).default([]),
  proposed_graph_changes: ProposedGraphChangesSchema.optional(),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;
