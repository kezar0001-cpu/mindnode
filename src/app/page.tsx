import { MindWorkspace } from "@/components/workspace/mind-workspace";
import {
  listRecentMemoryEntries,
  listPromotedMemoryIds,
} from "@/lib/memory/queries";
import {
  listEdges,
  listNodeDocumentSources,
  listNodeMemoryTrails,
  listNodes,
  listSourceDocuments,
} from "@/lib/graph/queries";
import { requireUser } from "@/lib/supabase/auth";

// Reads auth cookies on every request; never prerender.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

  const [recent, nodes, edges, promotedMemoryIds, sourceDocuments] =
    await Promise.all([
      listRecentMemoryEntries(20),
      listNodes(),
      listEdges(),
      listPromotedMemoryIds(),
      listSourceDocuments(),
    ]);

  const nodeIds = nodes.map((n) => n.id);
  const [memoryTrails, nodeDocumentSources] = await Promise.all([
    listNodeMemoryTrails(nodeIds),
    listNodeDocumentSources(nodeIds),
  ]);

  return (
    <MindWorkspace
      initialNodes={nodes}
      initialEdges={edges}
      memoryTrails={memoryTrails}
      recentEntries={recent}
      promotedMemoryIds={promotedMemoryIds}
      sourceDocuments={sourceDocuments}
      nodeDocumentSources={nodeDocumentSources}
      userEmail={user.email ?? ""}
    />
  );
}
