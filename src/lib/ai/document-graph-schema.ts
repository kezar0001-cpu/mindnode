import "server-only";

import { z } from "zod";

// Section-level graph extraction. OpenAI Structured Outputs (strict mode)
// requires every object to set additionalProperties:false and to list every
// property in `required`. The JSON Schema below mirrors the Zod shape exactly.

export const NODE_TYPES = [
  "section",
  "topic",
  "fact",
  "goal",
  "project",
  "person",
  "risk",
  "decision",
  "task",
  "role",
  "event",
  "constraint",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const GraphNodeSchema = z.object({
  stable_key: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  category: z.string().min(1).max(40),
  node_type: z.enum(NODE_TYPES),
  importance: z.number().min(0).max(1),
  source_excerpt: z.string().min(1).max(500),
  tags: z.array(z.string().min(1).max(40)).max(8),
});
export type GraphExtractionNode = z.infer<typeof GraphNodeSchema>;

export const GraphRelationshipSchema = z.object({
  source_key: z.string().min(1).max(80),
  target_key: z.string().min(1).max(80),
  relationship_type: z.string().min(1).max(40),
  reason: z.string().min(1).max(280),
  strength: z.number().min(0).max(1),
});
export type GraphExtractionRelationship = z.infer<typeof GraphRelationshipSchema>;

export const GraphDiagnosticsSchema = z.object({
  coverage_notes: z.string().max(600),
  omitted_content_reason: z.string().max(280).nullable(),
});

export const SectionGraphSchema = z.object({
  section_title: z.string().min(1).max(120),
  section_summary: z.string().min(1).max(800),
  nodes: z.array(GraphNodeSchema).min(0).max(20),
  relationships: z.array(GraphRelationshipSchema).max(40),
  diagnostics: GraphDiagnosticsSchema,
});
export type SectionGraph = z.infer<typeof SectionGraphSchema>;

// JSON Schema mirror for OpenAI Structured Outputs. Strict mode requires
// additionalProperties:false on every object and every property in required.
export const SECTION_GRAPH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "section_title",
    "section_summary",
    "nodes",
    "relationships",
    "diagnostics",
  ],
  properties: {
    section_title: { type: "string" },
    section_summary: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "stable_key",
          "title",
          "summary",
          "category",
          "node_type",
          "importance",
          "source_excerpt",
          "tags",
        ],
        properties: {
          stable_key: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          category: { type: "string" },
          node_type: { type: "string", enum: [...NODE_TYPES] },
          importance: { type: "number" },
          source_excerpt: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_key",
          "target_key",
          "relationship_type",
          "reason",
          "strength",
        ],
        properties: {
          source_key: { type: "string" },
          target_key: { type: "string" },
          relationship_type: { type: "string" },
          reason: { type: "string" },
          strength: { type: "number" },
        },
      },
    },
    diagnostics: {
      type: "object",
      additionalProperties: false,
      required: ["coverage_notes", "omitted_content_reason"],
      properties: {
        coverage_notes: { type: "string" },
        omitted_content_reason: { type: ["string", "null"] },
      },
    },
  },
};
