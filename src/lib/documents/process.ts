import "server-only";

import { chatCompletionJson } from "@/lib/ai/provider";
import { buildDocumentChunkMessages } from "@/lib/ai/document-prompts";
import {
  DocumentNotesResponseSchema,
  type DocumentNote,
} from "@/lib/ai/document-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ProcessResult = {
  notes_created: number;
  nodes_created: number;
  edges_created: number;
};

type ChunkInput = {
  id: string;
  chunk_index: number;
  content: string;
};

type ExistingNode = { id: string; title: string };

function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
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

function radialPosition(
  cluster: { x: number; y: number },
  index: number,
  total: number,
): { position_x: number; position_y: number } {
  // 35° gap between successive nodes; radius grows slowly so a long
  // document spirals outward instead of overlapping.
  const baseRadius = 240;
  const radius = baseRadius + index * 30;
  const stepRad = (35 * Math.PI) / 180;
  const safeTotal = Math.max(total, 1);
  const angle =
    Math.max(stepRad, (Math.PI * 2) / safeTotal) * index - Math.PI / 2;
  return {
    position_x: cluster.x + Math.cos(angle) * radius,
    position_y: cluster.y + Math.sin(angle) * radius,
  };
}

async function aiNotesForChunk(args: {
  filename: string;
  chunkIndex: number;
  totalChunks: number;
  chunkText: string;
  existingTitles: string[];
}): Promise<DocumentNote[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = buildDocumentChunkMessages({
      filename: args.filename,
      chunk_index: args.chunkIndex,
      total_chunks: args.totalChunks,
      chunk_text: args.chunkText,
      existing_node_titles: args.existingTitles,
      strict: attempt > 0,
    });
    const ai = await chatCompletionJson(messages);
    if (!ai.ok) {
      // Provider-level failure — retry once.
      if (attempt === 0) continue;
      throw new Error(`AI provider error for chunk ${args.chunkIndex}: ${ai.error}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      if (attempt === 0) continue;
      throw new Error(`AI returned invalid JSON for chunk ${args.chunkIndex}`);
    }

    const validated = DocumentNotesResponseSchema.safeParse(parsed);
    if (!validated.success) {
      if (attempt === 0) continue;
      throw new Error(`AI failed for chunk ${args.chunkIndex}`);
    }

    return validated.data.notes;
  }
  throw new Error(`AI failed for chunk ${args.chunkIndex}`);
}

export async function processDocumentChunks(args: {
  documentId: string;
  userId: string;
  filename: string;
  chunks: ChunkInput[];
}): Promise<ProcessResult> {
  const supabase = await createSupabaseServerClient();

  // Existing user graph context — used for suggested relationships.
  const { data: existingNodesRaw, error: existingErr } = await supabase
    .from("nodes")
    .select("id, title, position_x, position_y, created_at")
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false });
  if (existingErr) {
    throw new Error(`Failed to load existing nodes: ${existingErr.message}`);
  }
  const existingNodes: ExistingNode[] = (existingNodesRaw ?? []).map((n) => ({
    id: n.id,
    title: n.title,
  }));
  const existingByNormalizedTitle = new Map<string, string>();
  for (const n of existingNodesRaw ?? []) {
    existingByNormalizedTitle.set(normalizeTitle(n.title), n.id);
  }

  const clusterCenter = computeCentroid(
    (existingNodesRaw ?? []).slice(0, 8).map((n) => ({
      position_x: n.position_x,
      position_y: n.position_y,
    })),
  );

  let notesCreated = 0;
  let nodesCreated = 0;
  let edgesCreated = 0;

  type QueuedExternalEdge = {
    source_node_id: string;
    target_node_id: string;
    relationship_type: string;
  };
  const externalEdges: QueuedExternalEdge[] = [];
  const newNodeIdsInOrder: string[] = [];
  // Per-chunk existing titles list keeps the prompt within budget and
  // also lets the model reference notes we already created earlier in
  // the same document.
  const existingTitlesForPrompt = existingNodes.map((n) => n.title);

  for (const chunk of args.chunks) {
    const notes = await aiNotesForChunk({
      filename: args.filename,
      chunkIndex: chunk.chunk_index,
      totalChunks: args.chunks.length,
      chunkText: chunk.content,
      existingTitles: existingTitlesForPrompt.slice(0, 30),
    });

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const { position_x, position_y } = radialPosition(
        clusterCenter,
        nodesCreated,
        Math.max(args.chunks.length * 3, 8),
      );

      const { data: insertedNode, error: nodeError } = await supabase
        .from("nodes")
        .insert({
          user_id: args.userId,
          title: note.title.slice(0, 120),
          summary: note.summary.slice(0, 600),
          category: (note.category || "document").slice(0, 40),
          position_x,
          position_y,
          origin: "document_ai",
          ai_reason: `Generated from uploaded document: ${args.filename}`,
        })
        .select("id")
        .single();
      if (nodeError || !insertedNode) {
        console.error("Failed to insert node from doc AI:", nodeError?.message);
        continue;
      }
      nodesCreated += 1;
      newNodeIdsInOrder.push(insertedNode.id);

      const { error: noteError } = await supabase
        .from("document_notes")
        .insert({
          user_id: args.userId,
          document_id: args.documentId,
          chunk_id: chunk.id,
          node_id: insertedNode.id,
          title: note.title.slice(0, 120),
          summary: note.summary.slice(0, 600),
          category: (note.category || "document").slice(0, 40),
          source_excerpt: note.source_excerpt.slice(0, 500),
          confidence: note.confidence,
        });
      if (noteError) {
        console.error("Failed to insert document_note:", noteError.message);
      } else {
        notesCreated += 1;
      }

      // External relationships — match against existing graph titles only.
      // Conservative cap of 2 per note.
      let externalAdded = 0;
      for (const rel of note.suggested_relationships ?? []) {
        if (externalAdded >= 2) break;
        const targetId = existingByNormalizedTitle.get(
          normalizeTitle(rel.target_title),
        );
        if (!targetId || targetId === insertedNode.id) continue;
        externalEdges.push({
          source_node_id: insertedNode.id,
          target_node_id: targetId,
          relationship_type: (rel.relationship_type || "related").slice(0, 40),
        });
        externalAdded += 1;
      }

      // Update existing-titles map for next chunk so the prompt knows
      // about the notes we already created from this document.
      existingByNormalizedTitle.set(
        normalizeTitle(note.title),
        insertedNode.id,
      );
      existingTitlesForPrompt.unshift(note.title);
    }
  }

  // Same-document edges — chain consecutive new nodes for visual coherence.
  if (newNodeIdsInOrder.length >= 2) {
    const sameDocEdges = [];
    for (let i = 0; i < newNodeIdsInOrder.length - 1; i++) {
      sameDocEdges.push({
        user_id: args.userId,
        source_node_id: newNodeIdsInOrder[i],
        target_node_id: newNodeIdsInOrder[i + 1],
        relationship_type: "same_document",
        origin: "ai_suggested",
      });
    }
    if (sameDocEdges.length > 0) {
      const { data: inserted, error: sameDocErr } = await supabase
        .from("edges")
        .insert(sameDocEdges)
        .select("id");
      if (sameDocErr) {
        console.error("Failed to insert same_document edges:", sameDocErr.message);
      } else {
        edgesCreated += inserted?.length ?? 0;
      }
    }
  }

  // External edges from suggested_relationships → existing graph.
  if (externalEdges.length > 0) {
    const rows = externalEdges.map((e) => ({
      user_id: args.userId,
      source_node_id: e.source_node_id,
      target_node_id: e.target_node_id,
      relationship_type: e.relationship_type,
      origin: "ai_suggested",
    }));
    const { data: inserted, error: extErr } = await supabase
      .from("edges")
      .insert(rows)
      .select("id");
    if (extErr) {
      console.error("Failed to insert external edges:", extErr.message);
    } else {
      edgesCreated += inserted?.length ?? 0;
    }
  }

  return {
    notes_created: notesCreated,
    nodes_created: nodesCreated,
    edges_created: edgesCreated,
  };
}
