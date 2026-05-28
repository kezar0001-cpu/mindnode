import type { GraphNode } from "@/types";
import type { MemoryTrailMap } from "@/lib/graph/queries";

const trailFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(iso: string): string {
  return trailFormatter.format(new Date(iso));
}

type NodeDetailProps = {
  selectedNodeId: string | null;
  nodes: GraphNode[];
  memoryTrails: MemoryTrailMap;
};

export function NodeDetail({
  selectedNodeId,
  nodes,
  memoryTrails,
}: NodeDetailProps) {
  if (!selectedNodeId) {
    return (
      <>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Node detail
        </h2>
        <p className="text-sm text-neutral-500">
          Select a node to see its details.
        </p>
      </>
    );
  }

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) {
    return (
      <>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Node detail
        </h2>
        <p className="text-sm text-neutral-500">Node not found.</p>
      </>
    );
  }

  const trail = memoryTrails[node.id] ?? [];

  return (
    <>
      <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
        Node detail
      </h2>

      <div className="space-y-3">
        <div>
          <p className="text-base font-semibold text-neutral-100">{node.title}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{node.category}</p>
        </div>

        {node.summary && (
          <p className="text-sm text-neutral-300">{node.summary}</p>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Connected nodes
          </p>
          <p className="text-xs text-neutral-600">
            Edge creation coming soon.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Memory trail
          </p>
          {trail.length === 0 ? (
            <p className="text-xs text-neutral-600">No memories linked.</p>
          ) : (
            <ul className="space-y-2">
              {trail.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded border border-canvas-border bg-canvas-bg p-2"
                >
                  <p className="whitespace-pre-wrap break-words text-xs text-neutral-200">
                    {entry.content}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {formatTimestamp(entry.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
