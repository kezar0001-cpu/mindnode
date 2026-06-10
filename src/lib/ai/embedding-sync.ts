import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { embedTexts, toVectorLiteral } from "./embeddings";

// Keeps node and chunk embeddings in step with their content. Used inline
// after single-node creations, in batch after document processing, and
// opportunistically from the chat route to backfill anything missed.
// Always best-effort: callers treat failures as non-fatal.

type Supabase = SupabaseClient<Database>;

const NODE_TEXT_CHARS = 1500;
const CHUNK_TEXT_CHARS = 4000;

function nodeText(n: { title: string; summary: string; category: string }): string {
  return `${n.title}\n${n.category}\n${n.summary}`.slice(0, NODE_TEXT_CHARS);
}

// Embeds nodes and writes the vectors back. With `nodeIds`, those rows are
// (re-)embedded regardless of current state — use after edits. Without,
// backfills rows whose embedding is null, capped at `limit`.
export async function syncNodeEmbeddings(
  supabase: Supabase,
  userId: string,
  opts?: { nodeIds?: string[]; limit?: number },
): Promise<{ updated: number }> {
  let query = supabase
    .from("nodes")
    .select("id, title, summary, category")
    .eq("user_id", userId);
  if (opts?.nodeIds && opts.nodeIds.length > 0) {
    query = query.in("id", opts.nodeIds);
  } else {
    query = query.is("embedding", null).limit(opts?.limit ?? 64);
  }

  const { data: rows } = await query;
  if (!rows || rows.length === 0) return { updated: 0 };

  const result = await embedTexts(rows.map(nodeText));
  if (!result.ok) return { updated: 0 };

  const updates = rows.map((row, i) =>
    supabase
      .from("nodes")
      .update({ embedding: toVectorLiteral(result.embeddings[i]) })
      .eq("id", row.id)
      .eq("user_id", userId),
  );
  await Promise.all(updates);
  return { updated: rows.length };
}

export async function syncChunkEmbeddings(
  supabase: Supabase,
  userId: string,
  opts?: { limit?: number },
): Promise<{ updated: number }> {
  const { data: rows } = await supabase
    .from("document_chunks")
    .select("id, content, section_title")
    .eq("user_id", userId)
    .is("embedding", null)
    .limit(opts?.limit ?? 64);
  if (!rows || rows.length === 0) return { updated: 0 };

  const texts = rows.map((r) =>
    `${r.section_title ?? ""}\n${r.content}`.slice(0, CHUNK_TEXT_CHARS),
  );
  const result = await embedTexts(texts);
  if (!result.ok) return { updated: 0 };

  const updates = rows.map((row, i) =>
    supabase
      .from("document_chunks")
      .update({ embedding: toVectorLiteral(result.embeddings[i]) })
      .eq("id", row.id)
      .eq("user_id", userId),
  );
  await Promise.all(updates);
  return { updated: rows.length };
}
