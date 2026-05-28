import { MindWorkspace } from "@/components/workspace/mind-workspace";
import {
  listRecentMemoryEntries,
  listPromotedMemoryIds,
} from "@/lib/memory/queries";
import {
  listEdges,
  listNodeMemoryTrails,
  listNodes,
} from "@/lib/graph/queries";
import { requireUser } from "@/lib/supabase/auth";

// Reads auth cookies on every request; never prerender.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

  const [recent, nodes, edges, promotedMemoryIds] = await Promise.all([
    listRecentMemoryEntries(20),
    listNodes(),
    listEdges(),
    listPromotedMemoryIds(),
  ]);

  const memoryTrails = await listNodeMemoryTrails(nodes.map((n) => n.id));

  return (
    <MindWorkspace
      initialNodes={nodes}
      initialEdges={edges}
      memoryTrails={memoryTrails}
      recentEntries={recent}
      promotedMemoryIds={promotedMemoryIds}
      userEmail={user.email ?? ""}
    />
  );
}
