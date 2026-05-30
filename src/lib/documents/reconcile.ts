import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Supabase = SupabaseClient<Database>;

// A document that has been "Working…" longer than this but already has graph
// rows is treated as a crashed-late pipeline: the graph was built but the
// final status update never landed (e.g. the serverless function was killed).
const STALE_RECOVER_MS = 3 * 60 * 1000;
// With no graph rows at all, give it longer before declaring failure.
const STALE_FAIL_MS = 10 * 60 * 1000;

const IN_PROGRESS_STATUSES = [
  "uploaded",
  "extracting",
  "extracted",
  "processing",
];

const RECOVERY_WARNING =
  "Recovered from stale processing state. Graph data was created but the final status was not completed.";

const STALE_FAIL_MESSAGE =
  "Processing did not complete and no graph data was created. Please upload the document again.";

// Reconciles documents stuck in an in-progress status. User-scoped via the
// caller's RLS-bound client — never the service role. Best-effort: failures
// are swallowed so the documents list still renders.
export async function reconcileStaleDocuments(supabase: Supabase): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - STALE_RECOVER_MS).toISOString();

  const { data: stale } = await supabase
    .from("source_documents")
    .select("id, status, created_at, document_root_node_id")
    .in("status", IN_PROGRESS_STATUSES)
    .lt("created_at", cutoff)
    .limit(25);

  if (!stale || stale.length === 0) return;

  for (const doc of stale) {
    const { count: sectionNodeCount } = await supabase
      .from("document_sections")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id)
      .not("node_id", "is", null);
    const { count: noteCount } = await supabase
      .from("document_notes")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id);

    const hasGraph =
      Boolean(doc.document_root_node_id) ||
      (sectionNodeCount ?? 0) > 0 ||
      (noteCount ?? 0) > 0;

    if (hasGraph) {
      const nodesCreated =
        (doc.document_root_node_id ? 1 : 0) +
        (sectionNodeCount ?? 0) +
        (noteCount ?? 0);
      await supabase
        .from("source_documents")
        .update({
          status: "processed_with_warnings",
          warnings: [RECOVERY_WARNING],
          error_message: RECOVERY_WARNING,
          nodes_created: nodesCreated,
        })
        .eq("id", doc.id);
      continue;
    }

    // No graph rows — only fail it once it's been stuck well past the window,
    // so we don't kill a document that is still legitimately processing.
    if (new Date(doc.created_at).getTime() < now - STALE_FAIL_MS) {
      await supabase
        .from("source_documents")
        .update({ status: "failed", error_message: STALE_FAIL_MESSAGE })
        .eq("id", doc.id);
    }
  }
}
