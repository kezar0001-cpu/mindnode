"use client";

import { useState, useTransition } from "react";
import type { GraphNode, GraphEdge, NodeOrigin, EdgeOrigin } from "@/types";
import type {
  MemoryTrailMap,
  NodeDocumentSource,
} from "@/lib/graph/queries";
import { createEdgeAction } from "@/lib/graph/actions";
import { categoryColour } from "@/lib/graph/insights";

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

// Origin badge helpers.
function OriginBadge({ origin }: { origin: string }) {
  const isAiPinned = origin === "ai_pinned";
  const isDocument = origin === "document_ai";
  const label =
    origin === "memory"
      ? "From memory"
      : origin === "manual"
      ? "Manual"
      : origin === "ai_pinned"
      ? "AI exploration"
      : origin === "imported"
      ? "Imported"
      : origin === "document_ai"
      ? "Document"
      : origin;

  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        isAiPinned
          ? "border border-violet-400/40 bg-violet-950/30 text-violet-200"
          : isDocument
          ? "border border-blue-400/40 bg-blue-950/30 text-blue-200"
          : "border border-neutral-700 bg-neutral-800/50 text-neutral-400",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

// Edge origin badge — omit "manual" since it's the default.
function EdgeOriginBadge({ origin }: { origin: string }) {
  if (origin === "manual") return null;
  const label =
    origin === "auto_keyword" ? "auto" : origin === "ai_pinned" ? "ai" : origin;
  return (
    <span className="ml-1 rounded-full border border-neutral-700 bg-neutral-800/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-neutral-500">
      {label}
    </span>
  );
}

type NodeDetailProps = {
  selectedNodeId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  memoryTrails: MemoryTrailMap;
  nodeDocumentSources?: Record<string, NodeDocumentSource>;
  onSelectNode: (id: string) => void;
};

export function NodeDetail({
  selectedNodeId,
  nodes,
  edges,
  memoryTrails,
  nodeDocumentSources,
  onSelectNode,
}: NodeDetailProps) {
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [relType, setRelType] = useState("related");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
  const colours = categoryColour(node.category || "general");

  // Edges where this node is source OR target.
  const connections = edges
    .filter((e) => e.source_node_id === node.id || e.target_node_id === node.id)
    .map((e) => {
      const isOutgoing = e.source_node_id === node.id;
      const otherId = isOutgoing ? e.target_node_id : e.source_node_id;
      const other = nodes.find((n) => n.id === otherId);
      return { edge: e, other, isOutgoing };
    })
    .filter((c) => c.other !== undefined);

  const candidates = nodes.filter((n) => n.id !== node.id);

  const handleConnect = () => {
    if (!targetId) return;
    setSubmitError(null);
    startTransition(async () => {
      const result = await createEdgeAction(node.id, targetId, relType);
      if (!result.success) {
        setSubmitError(result.error ?? "Could not create connection.");
        return;
      }
      setShowConnectForm(false);
      setTargetId("");
      setRelType("related");
    });
  };

  return (
    <div className="space-y-4">
      {/* Title + category colour chip + origin badge */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold leading-snug text-neutral-100">
            {node.title}
          </p>
          {/* Category colour chip */}
          {node.category && (
            <span className="flex items-center gap-1 text-xs text-neutral-500">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: colours.stroke,
                  flexShrink: 0,
                }}
              />
              {node.category !== "general" ? node.category : "general"}
            </span>
          )}
        </div>
        {/* Origin badge */}
        {node.origin && (
          <div className="mt-1.5">
            <OriginBadge origin={node.origin as NodeOrigin} />
          </div>
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

      {/* "Why this was suggested" — only for AI-pinned nodes with a reason */}
      {node.origin === "ai_pinned" && node.ai_reason && (
        <div className="rounded-lg border border-dashed border-violet-400/40 bg-violet-950/15 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-300/70">
            Why this was suggested
          </p>
          <p className="text-xs leading-relaxed text-violet-100/80">
            {node.ai_reason}
          </p>
        </div>
      )}

      {/* Document source — only for document_ai nodes */}
      {node.origin === "document_ai" && nodeDocumentSources?.[node.id] && (
        <div className="rounded-lg border border-dashed border-blue-400/40 bg-blue-950/15 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">
            Source
          </p>
          <p className="text-xs text-blue-100/80">
            From {nodeDocumentSources[node.id].original_filename}
          </p>
          {nodeDocumentSources[node.id].source_excerpt && (
            <blockquote className="mt-2 border-l-2 border-blue-400/40 pl-2 text-xs italic leading-relaxed text-blue-100/70">
              &ldquo;{nodeDocumentSources[node.id].source_excerpt}&rdquo;
            </blockquote>
          )}
          {node.ai_reason && (
            <p className="mt-2 text-[11px] leading-relaxed text-blue-100/60">
              {node.ai_reason}
            </p>
          )}
        </div>
      )}

      {/* Memory trail — raw entries that built this node */}
      {trail.length > 0 ? (
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
      ) : (
        <div className="rounded-lg border border-dashed border-violet-300/30 bg-violet-950/10 p-3">
          <p className="text-xs leading-relaxed text-violet-100/80">
            Created from an AI exploration suggestion. No source memory attached yet.
          </p>
        </div>
      )}

      {/* Connections */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-600">
          {connections.length === 0
            ? "No connections yet"
            : connections.length === 1
            ? "1 connection"
            : `${connections.length} connections`}
        </p>

        {connections.length > 0 && (
          <ul className="space-y-2">
            {connections.map(({ edge, other, isOutgoing }) => (
              <li key={edge.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(other!.id)}
                  className="flex w-full items-center justify-between gap-3 rounded border border-canvas-border bg-canvas-bg px-3 py-2 text-left hover:border-teal-300/40"
                >
                  <span className="line-clamp-1 text-sm text-neutral-200">
                    {other!.title}
                  </span>
                  <span className="flex shrink-0 items-center text-xs text-neutral-500">
                    {isOutgoing ? "→" : "←"} {edge.label ?? edge.relationship_type}
                    <EdgeOriginBadge origin={edge.origin as EdgeOrigin} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!showConnectForm ? (
          candidates.length > 0 && (
            <button
              type="button"
              onClick={() => setShowConnectForm(true)}
              className="mt-3 text-xs text-neutral-400 hover:text-teal-300"
            >
              + Connect to another thought
            </button>
          )
        ) : (
          <div className="mt-3 space-y-2 rounded-lg border border-canvas-border bg-canvas-bg p-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Target thought</span>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="block w-full rounded border border-canvas-border bg-canvas-surface px-2 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
              >
                <option value="">Select a thought…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Relationship</span>
              <input
                type="text"
                value={relType}
                onChange={(e) => setRelType(e.target.value)}
                maxLength={40}
                placeholder="related, supports, leads to…"
                className="block w-full rounded border border-canvas-border bg-canvas-surface px-2 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
              />
            </label>

            {submitError && (
              <p className="text-xs text-red-400">{submitError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowConnectForm(false);
                  setSubmitError(null);
                }}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConnect}
                disabled={!targetId || isPending}
                className="rounded bg-teal-300 px-3 py-1.5 text-xs font-medium text-canvas-bg hover:bg-teal-200 disabled:opacity-40"
              >
                {isPending ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
