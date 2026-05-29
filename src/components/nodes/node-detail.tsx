"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { GraphNode, GraphEdge, NodeOrigin, EdgeOrigin } from "@/types";
import type {
  MemoryTrailMap,
  NodeDocumentSource,
} from "@/lib/graph/queries";
import {
  createEdgeAction,
  deleteNodeAction,
  deleteEdgeAction,
  updateNodeAction,
  updateEdgeAction,
} from "@/lib/graph/actions";
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

function OriginBadge({ origin }: { origin: string }) {
  const isAiPinned = origin === "ai_pinned";
  const isDocument =
    origin === "document_ai" ||
    origin === "document_root" ||
    origin === "document_section";
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
      : origin === "document_root"
      ? "Document root"
      : origin === "document_section"
      ? "Section"
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

function NodeTypePill({ nodeType }: { nodeType: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-violet-400/40 bg-violet-950/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-200">
      {nodeType}
    </span>
  );
}

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
  onNodeDeleted: () => void;
};

export function NodeDetail({
  selectedNodeId,
  nodes,
  edges,
  memoryTrails,
  nodeDocumentSources,
  onSelectNode,
  onNodeDeleted,
}: NodeDetailProps) {
  const router = useRouter();

  // Connect form
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [relType, setRelType] = useState("related");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Edit node
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isPendingEdit, startEditTransition] = useTransition();

  // Delete node (two-step)
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPendingDelete, startDeleteTransition] = useTransition();

  // Edge controls
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editingRelType, setEditingRelType] = useState("");
  const [confirmDeleteEdgeId, setConfirmDeleteEdgeId] = useState<string | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [isPendingEdge, startEdgeTransition] = useTransition();

  // Reset all interaction state whenever the user selects a different node.
  useEffect(() => {
    setEditMode(false);
    setEditTitle("");
    setEditSummary("");
    setEditCategory("");
    setEditError(null);
    setDeleteConfirm(false);
    setDeleteError(null);
    setEditingEdgeId(null);
    setEditingRelType("");
    setConfirmDeleteEdgeId(null);
    setEdgeError(null);
    setShowConnectForm(false);
    setTargetId("");
    setRelType("related");
    setSubmitError(null);
  }, [selectedNodeId]);

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

  // ---- Connect handler ----
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
      router.refresh();
    });
  };

  // ---- Edit node handlers ----
  const handleStartEdit = () => {
    setEditTitle(node.title);
    setEditSummary(node.summary ?? "");
    setEditCategory(node.category ?? "general");
    setEditError(null);
    setEditMode(true);
  };

  const handleSaveEdit = () => {
    setEditError(null);
    startEditTransition(async () => {
      const result = await updateNodeAction(node.id, {
        title: editTitle,
        summary: editSummary,
        category: editCategory,
      });
      if (!result.success) {
        setEditError(result.error ?? "Could not update node.");
        return;
      }
      setEditMode(false);
      router.refresh();
    });
  };

  // ---- Delete node handlers ----
  const handleDeleteNode = () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteNodeAction(node.id);
      if (!result.success) {
        setDeleteError(result.error ?? "Could not delete node.");
        setDeleteConfirm(false);
        return;
      }
      router.refresh();
      onNodeDeleted();
    });
  };

  // ---- Edge handlers ----
  const handleStartEditEdge = (edgeId: string, currentType: string) => {
    setEditingEdgeId(edgeId);
    setEditingRelType(currentType);
    setEdgeError(null);
    setConfirmDeleteEdgeId(null);
  };

  const handleSaveEdge = (edgeId: string) => {
    setEdgeError(null);
    startEdgeTransition(async () => {
      const result = await updateEdgeAction(edgeId, editingRelType);
      if (!result.success) {
        setEdgeError(result.error ?? "Could not update connection.");
        return;
      }
      setEditingEdgeId(null);
      setEditingRelType("");
      router.refresh();
    });
  };

  const handleDeleteEdge = (edgeId: string) => {
    if (confirmDeleteEdgeId !== edgeId) {
      setConfirmDeleteEdgeId(edgeId);
      setEditingEdgeId(null);
      return;
    }
    setEdgeError(null);
    startEdgeTransition(async () => {
      const result = await deleteEdgeAction(edgeId);
      if (!result.success) {
        setEdgeError(result.error ?? "Could not delete connection.");
        setConfirmDeleteEdgeId(null);
        return;
      }
      setConfirmDeleteEdgeId(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {/* Title + edit button */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold leading-snug text-neutral-100">
                {node.title}
              </p>
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
            {node.origin && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <OriginBadge origin={node.origin as NodeOrigin} />
                {nodeDocumentSources?.[node.id]?.node_type && (
                  <NodeTypePill
                    nodeType={nodeDocumentSources[node.id].node_type as string}
                  />
                )}
              </div>
            )}
          </div>
          {!editMode && (
            <button
              type="button"
              onClick={handleStartEdit}
              className="shrink-0 rounded border border-canvas-border bg-canvas-bg px-2.5 py-1 text-xs text-neutral-400 hover:border-teal-300/40 hover:text-teal-300"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editMode ? (
        <div className="space-y-2 rounded-lg border border-teal-300/30 bg-canvas-bg p-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Title</span>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={120}
              className="block w-full rounded border border-canvas-border bg-canvas-surface px-2 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Summary</span>
            <textarea
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              maxLength={2000}
              rows={4}
              className="block w-full resize-none rounded border border-canvas-border bg-canvas-surface px-2 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Category</span>
            <input
              type="text"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              maxLength={40}
              placeholder="general"
              className="block w-full rounded border border-canvas-border bg-canvas-surface px-2 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
            />
          </label>
          {editError && <p className="text-xs text-red-400">{editError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditMode(false)}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={!editTitle.trim() || isPendingEdit}
              className="rounded bg-teal-300 px-3 py-1.5 text-xs font-medium text-canvas-bg hover:bg-teal-200 disabled:opacity-40"
            >
              {isPendingEdit ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Full thought content */}
          {node.summary && (
            <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-200">
                {node.summary}
              </p>
            </div>
          )}

          {/* AI pinned reason */}
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

          {/* Document source */}
          {(node.origin === "document_ai" ||
            node.origin === "document_root" ||
            node.origin === "document_section") &&
            nodeDocumentSources?.[node.id] && (
              <div className="rounded-lg border border-dashed border-blue-400/40 bg-blue-950/15 p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">
                  Source
                </p>
                <p className="text-xs text-blue-100/80">
                  From {nodeDocumentSources[node.id].original_filename}
                </p>
                {nodeDocumentSources[node.id].source_section_title && (
                  <p className="mt-0.5 text-[11px] text-blue-100/70">
                    Section: {nodeDocumentSources[node.id].source_section_title}
                  </p>
                )}
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

          {/* Document root/section fallback */}
          {(node.origin === "document_root" || node.origin === "document_section") &&
            !nodeDocumentSources?.[node.id] &&
            node.ai_reason && (
              <div className="rounded-lg border border-dashed border-blue-400/40 bg-blue-950/15 p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">
                  About this node
                </p>
                <p className="text-xs leading-relaxed text-blue-100/80">
                  {node.ai_reason}
                </p>
              </div>
            )}
        </>
      )}

      {/* Memory trail */}
      {!editMode && (
        <>
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
                {connections.map(({ edge, other, isOutgoing }) => {
                  const isEditingThis = editingEdgeId === edge.id;
                  const isConfirmingDelete = confirmDeleteEdgeId === edge.id;
                  const displayType = edge.label ?? edge.relationship_type;

                  return (
                    <li key={edge.id} className="rounded border border-canvas-border bg-canvas-bg">
                      {/* Navigate row */}
                      <button
                        type="button"
                        onClick={() => onSelectNode(other!.id)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-canvas-surface/50"
                      >
                        <span className="line-clamp-1 text-sm text-neutral-200">
                          {other!.title}
                        </span>
                        <span className="flex shrink-0 items-center text-xs text-neutral-500">
                          {isOutgoing ? "→" : "←"}{" "}
                          {isEditingThis ? editingRelType || displayType : displayType}
                          <EdgeOriginBadge origin={edge.origin as EdgeOrigin} />
                        </span>
                      </button>

                      {/* Inline edge edit */}
                      {isEditingThis && (
                        <div className="border-t border-canvas-border px-3 py-2">
                          <input
                            type="text"
                            value={editingRelType}
                            onChange={(e) => setEditingRelType(e.target.value)}
                            maxLength={40}
                            placeholder="related, supports, leads to…"
                            className="block w-full rounded border border-canvas-border bg-canvas-surface px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-teal-300"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingEdgeId(null)}
                              className="text-xs text-neutral-500 hover:text-neutral-300"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEdge(edge.id)}
                              disabled={!editingRelType.trim() || isPendingEdge}
                              className="rounded bg-teal-300 px-3 py-1 text-xs font-medium text-canvas-bg hover:bg-teal-200 disabled:opacity-40"
                            >
                              {isPendingEdge ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Delete confirmation row */}
                      {isConfirmingDelete && (
                        <div className="flex items-center justify-between border-t border-canvas-border px-3 py-2">
                          <p className="text-xs text-red-400">Remove this connection?</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteEdgeId(null)}
                              className="text-xs text-neutral-500 hover:text-neutral-300"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEdge(edge.id)}
                              disabled={isPendingEdge}
                              className="rounded bg-red-900/60 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-900/80 disabled:opacity-40"
                            >
                              {isPendingEdge ? "Removing…" : "Remove"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Edge action buttons */}
                      {!isEditingThis && !isConfirmingDelete && (
                        <div className="flex justify-end gap-1 border-t border-canvas-border px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEditEdge(edge.id, edge.relationship_type)}
                            title="Edit relationship"
                            className="rounded px-2 py-1 text-[10px] text-neutral-500 hover:bg-canvas-surface hover:text-teal-300"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEdge(edge.id)}
                            title="Delete relationship"
                            className="rounded px-2 py-1 text-[10px] text-neutral-500 hover:bg-canvas-surface hover:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {edgeError && (
              <p className="mt-2 text-xs text-red-400">{edgeError}</p>
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

          {/* Delete node section */}
          <div className="border-t border-canvas-border pt-4">
            {deleteError && (
              <p className="mb-2 text-xs text-red-400">{deleteError}</p>
            )}
            {deleteConfirm ? (
              <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-3">
                <p className="mb-2 text-xs text-red-300">
                  Delete this node? Its connections will also be removed.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(false)}
                    className="text-xs text-neutral-400 hover:text-neutral-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteNode}
                    disabled={isPendingDelete}
                    className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40"
                  >
                    {isPendingDelete ? "Deleting…" : "Confirm delete"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDeleteNode}
                className="text-xs text-red-500/70 hover:text-red-400"
              >
                Delete node
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
