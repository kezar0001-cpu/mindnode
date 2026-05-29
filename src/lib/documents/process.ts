import "server-only";

import { buildSectionGraphMessages } from "@/lib/ai/document-graph-prompts";
import {
  SECTION_GRAPH_JSON_SCHEMA,
  SectionGraphSchema,
  type SectionGraph,
} from "@/lib/ai/document-graph-schema";
import { callJsonForTask, callStructuredForTask } from "@/lib/ai/router";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeDocumentClusterLayout } from "./layout";
import {
  findRelatedExistingNodes,
  type ExistingNodeForSimilarity,
} from "@/lib/graph/similarity";
import type { DocumentSection } from "./structure";
import type { SectionChunk } from "./chunk";

export type ProcessResult = {
  document_root_node_id: string | null;
  section_count: number;
  chunk_count: number;
  nodes_created: number;
  edges_created: number;
  notes_created: number;
  warnings: string[];
  diagnostics: Record<string, unknown>;
};

type ProcessArgs = {
  documentId: string;
  userId: string;
  filename: string;
  documentTitle: string;
  sections: DocumentSection[];
  chunks: SectionChunk[];
};

function logDocumentGraph(stage: string, details: Record<string, unknown> = {}) {
  console.info(`[documents/process] ${stage}`, details);
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function computeCentroid(
  nodes: { position_x: number; position_y: number }[],
): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const n of nodes) {
    sx += n.position_x;
    sy += n.position_y;
  }
  return { x: sx / nodes.length, y: sy / nodes.length };
}

async function extractSectionGraph(args: {
  filename: string;
  documentTitle: string;
  section: DocumentSection;
  sectionCount: number;
  chunk: SectionChunk;
  existingTitles: string[];
}): Promise<{ graph: SectionGraph | null; aiError: string | null }> {
  const buildMessages = (strict: boolean) =>
    buildSectionGraphMessages({
      filename: args.filename,
      document_title: args.documentTitle,
      section_index: args.section.index,
      section_count: args.sectionCount,
      section_title: args.section.title,
      section_level: args.section.level,
      chunk_text: args.chunk.content,
      existing_node_titles: args.existingTitles,
      strict,
    });

  // Attempt 1 — structured output via the heavyweight model.
  const r1 = await callStructuredForTask<SectionGraph>(
    "document_graph",
    buildMessages(false),
    { name: "SectionGraph", jsonSchema: SECTION_GRAPH_JSON_SCHEMA },
    (raw) => {
      const parsed = SectionGraphSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }
      return { ok: true, data: parsed.data };
    },
  );
  if (r1.ok && r1.data.nodes.length > 0) {
    return { graph: r1.data, aiError: null };
  }

  // Attempt 2 — structured output on the faster model with a strict reminder.
  const r2 = await callStructuredForTask<SectionGraph>(
    "document_graph_fast",
    buildMessages(true),
    { name: "SectionGraph", jsonSchema: SECTION_GRAPH_JSON_SCHEMA },
    (raw) => {
      const parsed = SectionGraphSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }
      return { ok: true, data: parsed.data };
    },
  );
  if (r2.ok && r2.data.nodes.length > 0) {
    return { graph: r2.data, aiError: null };
  }

  // Final fallback — JSON mode on fast model, parsed with the same Zod schema.
  const r3 = await callJsonForTask("document_graph_fast", buildMessages(true));
  if (r3.ok) {
    try {
      const raw = JSON.parse(r3.content);
      const parsed = SectionGraphSchema.safeParse(raw);
      if (parsed.success && parsed.data.nodes.length > 0) {
        return { graph: parsed.data, aiError: null };
      }
    } catch {
      // fall through to error
    }
  }

  const err =
    (!r1.ok && r1.error) ||
    (!r2.ok && r2.error) ||
    (!r3.ok && r3.error) ||
    "AI returned no nodes";
  return { graph: null, aiError: err };
}

export async function processDocumentGraph(
  args: ProcessArgs,
): Promise<ProcessResult> {
  const supabase = await createSupabaseServerClient();
  const warnings: string[] = [];
  logDocumentGraph("started", {
    documentId: args.documentId,
    userId: args.userId,
    sections: args.sections.length,
    chunks: args.chunks.length,
  });
  const diagnostics: Record<string, unknown> = {};

  // ---- Existing graph context -------------------------------------------
  const { data: existingNodesRaw, error: existingErr } = await supabase
    .from("nodes")
    .select("id, title, summary, category, position_x, position_y, created_at")
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false });
  if (existingErr) {
    throw new Error(`Failed to load existing nodes: ${existingErr.message}`);
  }
  const existingNodes = existingNodesRaw ?? [];
  logDocumentGraph("loaded existing graph context", {
    documentId: args.documentId,
    existingNodes: existingNodes.length,
  });
  const existingForSimilarity: ExistingNodeForSimilarity[] = existingNodes.map(
    (n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      category: n.category,
    }),
  );
  const existingTitlesForPrompt = existingNodes.map((n) => n.title);

  const centroid = computeCentroid(
    existingNodes.slice(0, 8).map((n) => ({
      position_x: n.position_x,
      position_y: n.position_y,
    })),
  );

  // ---- Pass 1: structural scaffold --------------------------------------
  // Insert document_sections rows first so chunks can reference them.
  const sectionRows = args.sections.map((s) => ({
    id: s.id,
    user_id: args.userId,
    document_id: args.documentId,
    section_index: s.index,
    title: truncate(s.title, 120),
    level: s.level,
    char_count: s.char_count,
    word_count: s.word_count,
    start_offset: s.start_offset,
    end_offset: s.end_offset,
  }));
  if (sectionRows.length > 0) {
    logDocumentGraph("inserting document_sections", {
      documentId: args.documentId,
      sections: sectionRows.length,
    });
    const { error } = await supabase.from("document_sections").insert(sectionRows);
    if (error) {
      throw new Error(`Failed to insert sections: ${error.message}`);
    }
  }

  // Insert chunks with section metadata.
  const chunkRows = args.chunks.map((c) => ({
    user_id: args.userId,
    document_id: args.documentId,
    chunk_index: c.chunk_index,
    content: c.content,
    token_estimate: c.token_estimate,
    section_id: c.section_id,
    section_title: c.section_title,
    section_level: c.section_level,
    section_index: c.section_index,
  }));
  let chunkIdByIndex = new Map<number, string>();
  if (chunkRows.length > 0) {
    logDocumentGraph("inserting document_chunks", {
      documentId: args.documentId,
      chunks: chunkRows.length,
    });
    const { data, error } = await supabase
      .from("document_chunks")
      .insert(chunkRows)
      .select("id, chunk_index");
    if (error || !data) {
      throw new Error(`Failed to insert chunks: ${error?.message ?? "unknown"}`);
    }
    chunkIdByIndex = new Map(data.map((d) => [d.chunk_index, d.id]));
  }

  // Cluster layout for root + sections.
  const layout = computeDocumentClusterLayout({
    sectionIds: args.sections.map((s) => s.id),
    centerX: centroid.x,
    centerY: centroid.y,
  });

  // Insert document_root node.
  logDocumentGraph("inserting document root node", { documentId: args.documentId });
  const { data: rootNode, error: rootErr } = await supabase
    .from("nodes")
    .insert({
      user_id: args.userId,
      title: truncate(args.documentTitle || args.filename, 120),
      summary: `Document: ${args.filename}`,
      category: "document",
      position_x: layout.root.x,
      position_y: layout.root.y,
      origin: "document_root",
      ai_reason: `Root of uploaded document: ${args.filename}`,
    })
    .select("id")
    .single();
  if (rootErr || !rootNode) {
    throw new Error(`Failed to insert document root node: ${rootErr?.message}`);
  }
  const rootNodeId = rootNode.id;
  logDocumentGraph("document root node inserted", {
    documentId: args.documentId,
    rootNodeId,
  });

  await supabase
    .from("source_documents")
    .update({ document_root_node_id: rootNodeId })
    .eq("id", args.documentId)
    .eq("user_id", args.userId);

  // Insert section nodes.
  const sectionNodeIdById = new Map<string, string>();
  const sectionByIdLocal = new Map<string, DocumentSection>();
  for (const s of args.sections) sectionByIdLocal.set(s.id, s);

  for (const s of layout.sections) {
    const section = sectionByIdLocal.get(s.section_id);
    if (!section) continue;
    const { data: sNode, error: sErr } = await supabase
      .from("nodes")
      .insert({
        user_id: args.userId,
        title: truncate(section.title, 120),
        summary: `Section of ${args.documentTitle}`,
        category: "document",
        position_x: s.x,
        position_y: s.y,
        origin: "document_section",
        ai_reason: `Section ${section.index + 1} of ${args.documentTitle}`,
      })
      .select("id")
      .single();
    if (sErr || !sNode) {
      warnings.push(`Failed to insert section node: ${section.title}`);
      continue;
    }
    sectionNodeIdById.set(section.id, sNode.id);
    await supabase
      .from("document_sections")
      .update({ node_id: sNode.id })
      .eq("id", section.id)
      .eq("user_id", args.userId);
  }

  // Insert root -> section "contains" edges.
  const containsRootEdges = [];
  for (const sec of args.sections) {
    const sNodeId = sectionNodeIdById.get(sec.id);
    if (!sNodeId) continue;
    containsRootEdges.push({
      user_id: args.userId,
      source_node_id: rootNodeId,
      target_node_id: sNodeId,
      relationship_type: "contains",
      origin: "document_structure",
    });
  }
  let edgesCreated = 0;
  let nodesCreated = 1 + sectionNodeIdById.size; // root + sections
  if (containsRootEdges.length > 0) {
    const { data, error } = await supabase
      .from("edges")
      .insert(containsRootEdges)
      .select("id");
    if (error) {
      warnings.push(`Failed to insert root contains edges: ${error.message}`);
    } else {
      edgesCreated += data?.length ?? 0;
    }
  }

  // ---- Pass 2: per-section graph extraction -----------------------------
  let notesCreated = 0;
  let aiCalls = 0;
  let aiFailures = 0;
  const sectionsWithWarnings: number[] = [];
  let totalChars = 0;
  for (const s of args.sections) totalChars += s.char_count;

  // Group chunks by section so we can iterate per-section.
  const chunksBySection = new Map<string, SectionChunk[]>();
  for (const c of args.chunks) {
    const list = chunksBySection.get(c.section_id);
    if (list) list.push(c);
    else chunksBySection.set(c.section_id, [c]);
  }

  for (const section of args.sections) {
    logDocumentGraph("processing section graph", {
      documentId: args.documentId,
      sectionIndex: section.index,
      sectionTitle: section.title,
    });
    const sectionNodeId = sectionNodeIdById.get(section.id);
    const chunkList = chunksBySection.get(section.id) ?? [];
    if (chunkList.length === 0 || !sectionNodeId) continue;

    let sectionGotNodes = false;

    for (const chunk of chunkList) {
      aiCalls += 1;
      const { graph, aiError } = await extractSectionGraph({
        filename: args.filename,
        documentTitle: args.documentTitle,
        section,
        sectionCount: args.sections.length,
        chunk,
        existingTitles: existingTitlesForPrompt.slice(0, 30),
      });
      if (!graph) {
        aiFailures += 1;
        warnings.push(
          `Section ${section.index + 1} "${section.title}": AI failed${aiError ? ` (${aiError.slice(0, 120)})` : ""}`,
        );
        sectionsWithWarnings.push(section.index);
        continue;
      }

      // Insert child nodes.
      const childNodeIdByStableKey = new Map<string, string>();
      const childOrder: { stableKey: string; nodeId: string }[] = [];
      for (let i = 0; i < graph.nodes.length; i++) {
        const node = graph.nodes[i];
        const { position_x, position_y } = layout.childPositionFor(
          section.id,
          i,
          graph.nodes.length,
        );
        const aiReason = `From ${args.documentTitle} → ${section.title}. Importance ${node.importance.toFixed(2)}.`;
        const { data: insertedNode, error: nodeError } = await supabase
          .from("nodes")
          .insert({
            user_id: args.userId,
            title: truncate(node.title, 120),
            summary: truncate(node.summary, 600),
            category: truncate(node.category || "document", 40),
            position_x,
            position_y,
            origin: "document_ai",
            ai_reason: aiReason,
          })
          .select("id")
          .single();
        if (nodeError || !insertedNode) {
          warnings.push(
            `Failed to insert child node in section "${section.title}": ${nodeError?.message ?? "unknown"}`,
          );
          continue;
        }
        nodesCreated += 1;
        sectionGotNodes = true;
        childNodeIdByStableKey.set(node.stable_key, insertedNode.id);
        childOrder.push({ stableKey: node.stable_key, nodeId: insertedNode.id });

        // document_notes row keeps the source excerpt + AI metadata.
        const chunkId = chunkIdByIndex.get(chunk.chunk_index) ?? null;
        const { error: noteErr } = await supabase.from("document_notes").insert({
          user_id: args.userId,
          document_id: args.documentId,
          chunk_id: chunkId,
          node_id: insertedNode.id,
          title: truncate(node.title, 120),
          summary: truncate(node.summary, 600),
          category: truncate(node.category || "document", 40),
          source_excerpt: truncate(node.source_excerpt, 500),
          confidence: node.importance,
          node_type: node.node_type,
          source_section_title: section.title,
          importance: node.importance,
          stable_key: node.stable_key,
          tags: node.tags,
        });
        if (noteErr) {
          warnings.push(`Failed to insert document_note: ${noteErr.message}`);
        } else {
          notesCreated += 1;
        }

        // Cross-document similarity links (conservative, max 2 per node).
        const related = findRelatedExistingNodes({
          candidate: {
            title: node.title,
            summary: node.summary,
            category: node.category,
            tags: node.tags,
          },
          existing: existingForSimilarity,
          maxResults: 2,
        });
        if (related.length > 0) {
          const rows = related
            .filter((r) => r.id !== insertedNode.id)
            .map((r) => ({
              user_id: args.userId,
              source_node_id: insertedNode.id,
              target_node_id: r.id,
              relationship_type: "relates_to",
              origin: "document_ai",
            }));
          if (rows.length > 0) {
            const { data: relIns, error: relErr } = await supabase
              .from("edges")
              .insert(rows)
              .select("id");
            if (relErr) {
              warnings.push(`Failed to insert similarity edges: ${relErr.message}`);
            } else {
              edgesCreated += relIns?.length ?? 0;
            }
          }
        }
      }

      // Section -> child "contains" edges.
      if (childOrder.length > 0) {
        const rows = childOrder.map((c) => ({
          user_id: args.userId,
          source_node_id: sectionNodeId,
          target_node_id: c.nodeId,
          relationship_type: "contains",
          origin: "document_structure",
        }));
        const { data: insRows, error: insErr } = await supabase
          .from("edges")
          .insert(rows)
          .select("id");
        if (insErr) {
          warnings.push(`Failed to insert section contains edges: ${insErr.message}`);
        } else {
          edgesCreated += insRows?.length ?? 0;
        }
      }

      // Typed intra-section relationships from AI.
      if (graph.relationships.length > 0) {
        const rows = [];
        for (const rel of graph.relationships) {
          const srcId = childNodeIdByStableKey.get(rel.source_key);
          const tgtId = childNodeIdByStableKey.get(rel.target_key);
          if (!srcId || !tgtId || srcId === tgtId) continue;
          rows.push({
            user_id: args.userId,
            source_node_id: srcId,
            target_node_id: tgtId,
            relationship_type: truncate(rel.relationship_type, 40),
            strength: rel.strength,
            origin: "document_ai",
          });
        }
        if (rows.length > 0) {
          const { data: relRows, error: relErr } = await supabase
            .from("edges")
            .insert(rows)
            .select("id");
          if (relErr) {
            warnings.push(`Failed to insert typed relationships: ${relErr.message}`);
          } else {
            edgesCreated += relRows?.length ?? 0;
          }
        }
      }
    }

    if (!sectionGotNodes) {
      sectionsWithWarnings.push(section.index);
    }
  }

  // ---- Quality guard ----------------------------------------------------
  const totalChildNodes = nodesCreated - 1 - sectionNodeIdById.size;
  const lowYield =
    totalChildNodes < 10 && totalChars > 5000 && args.sections.length > 3;
  if (lowYield) {
    warnings.push(
      `Low yield: only ${totalChildNodes} child nodes for ${args.sections.length} sections (${totalChars} chars).`,
    );
  }

  logDocumentGraph("completed", {
    documentId: args.documentId,
    nodesCreated,
    edgesCreated,
    notesCreated,
    warnings: warnings.length,
    aiCalls,
    aiFailures,
  });

  diagnostics.ai_calls = aiCalls;
  diagnostics.ai_failures = aiFailures;
  diagnostics.sections_with_warnings = Array.from(new Set(sectionsWithWarnings));
  diagnostics.low_yield = lowYield;
  diagnostics.total_chars = totalChars;
  diagnostics.total_child_nodes = totalChildNodes;

  return {
    document_root_node_id: rootNodeId,
    section_count: args.sections.length,
    chunk_count: args.chunks.length,
    nodes_created: nodesCreated,
    edges_created: edgesCreated,
    notes_created: notesCreated,
    warnings,
    diagnostics,
  };
}
