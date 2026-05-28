import type { GraphNode } from "@/types";
import type { MemoryTrailMap } from "@/lib/graph/queries";

const trailFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
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
      <p className="text-sm text-neutral-600">
        Tap a node to read it.
      </p>
    );
  }

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) {
    return <p className="text-sm text-neutral-600">Node not found.</p>;
  }

  const trail = memoryTrails[node.id] ?? [];

  return (
    <div className="space-y-4">
      {/* Title + category */}
      <div>
        <p className="text-base font-semibold leading-snug text-neutral-100">
          {node.title}
        </p>
        {node.category && node.category !== "general" && (
          <p className="mt-0.5 text-xs text-neutral-600">{node.category}</p>
        )}
      </div>

      {/* Full thought content — this is what the node is about */}
      {node.summary && (
        <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-200">
            {node.summary}
          </p>
        </div>
      )}

      {/* Memory trail — raw entries that built this node */}
      {trail.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-600">
            {trail.length === 1 ? "1 memory" : `${trail.length} memories`}
          </p>
          <ul className="space-y-2">
            {trail.map((entry) => (
              <li
                key={entry.id}
                className="rounded border border-canvas-border bg-canvas-bg px-3 py-2"
              >
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-300">
                  {entry.content}
                </p>
                <p className="mt-1.5 text-xs text-neutral-600">
                  {formatTimestamp(entry.created_at)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
