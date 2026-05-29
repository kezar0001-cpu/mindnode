"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SourceDocument } from "@/lib/graph/queries";
import { deleteDocumentGraphAction } from "@/lib/graph/actions";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function fileLabel(mime: string, filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime.includes("pdf")) return "PDF";
  if (ext === "docx" || mime.includes("wordprocessing")) return "DOCX";
  if (ext === "md" || mime.includes("markdown")) return "MD";
  return "TXT";
}

function statusStyle(status: string): { label: string; className: string } {
  switch (status) {
    case "processed":
      return {
        label: "Processed",
        className: "border-emerald-500/40 bg-emerald-950/30 text-emerald-200",
      };
    case "processed_with_warnings":
      return {
        label: "Warnings",
        className: "border-amber-500/40 bg-amber-950/30 text-amber-200",
      };
    case "failed":
      return {
        label: "Failed",
        className: "border-red-500/40 bg-red-950/30 text-red-200",
      };
    case "processing":
    case "extracting":
    case "extracted":
    case "uploaded":
      return {
        label: "Working…",
        className: "border-amber-500/40 bg-amber-950/30 text-amber-200",
      };
    default:
      return {
        label: status,
        className: "border-neutral-700 bg-neutral-800/50 text-neutral-300",
      };
  }
}

export function DocumentStatusCard({
  document,
  onSelectNode,
}: {
  document: SourceDocument;
  onSelectNode?: (nodeId: string) => void;
}) {
  const router = useRouter();
  const type = fileLabel(document.mime_type, document.original_filename);
  const status = statusStyle(document.status);
  const hasCounts =
    document.section_count > 0 ||
    document.chunk_count > 0 ||
    document.nodes_created > 0 ||
    document.edges_created > 0;

  const canDelete =
    document.status === "processed" ||
    document.status === "processed_with_warnings" ||
    document.status === "failed";

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteDocumentGraphAction(document.id);
      if (!result.success) {
        setDeleteError(result.error ?? "Could not delete document graph.");
        setConfirmDelete(false);
        return;
      }
      const count = result.nodesDeleted ?? 0;
      setDeleteResult(
        count === 0
          ? "Graph removed."
          : `Removed ${count} node${count === 1 ? "" : "s"} from graph.`,
      );
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 items-center rounded border border-neutral-700 bg-neutral-800/50 px-1.5 text-[10px] font-medium text-neutral-300">
              {type}
            </span>
            <p className="line-clamp-1 text-sm font-medium text-neutral-100">
              {document.original_filename}
            </p>
          </div>
          {hasCounts ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
              <span>{document.section_count} sections</span>
              <span className="text-neutral-700">·</span>
              <span>{document.chunk_count} chunks</span>
              <span className="text-neutral-700">·</span>
              <span>{document.nodes_created} nodes</span>
              <span className="text-neutral-700">·</span>
              <span>{document.edges_created} edges</span>
              {document.warnings_count > 0 && (
                <>
                  <span className="text-neutral-700">·</span>
                  <span className="rounded-full border border-amber-500/40 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                    {document.warnings_count} warning
                    {document.warnings_count === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-neutral-500">
              {document.status === "failed" ? "No notes" : "Awaiting AI…"}
            </p>
          )}
          <p className="mt-1 text-[11px] text-neutral-600">
            {dateFormatter.format(new Date(document.created_at))}
          </p>
          {document.status === "failed" && document.error_message && (
            <p className="mt-1.5 line-clamp-2 text-xs text-red-400/80">
              {document.error_message}
            </p>
          )}

          {/* View in graph button */}
          {document.document_root_node_id && onSelectNode && !deleteResult && (
            <button
              type="button"
              onClick={() => onSelectNode(document.document_root_node_id!)}
              className="mt-2 text-[11px] text-teal-400/70 hover:text-teal-300"
            >
              View in graph →
            </button>
          )}

          {/* Delete graph controls */}
          {canDelete && !deleteResult && (
            <div className="mt-2">
              {deleteError && (
                <p className="mb-1 text-xs text-red-400">{deleteError}</p>
              )}
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-red-400">
                    Remove{" "}
                    {document.nodes_created > 0
                      ? `${document.nodes_created} node${document.nodes_created === 1 ? "" : "s"} and `
                      : ""}
                    this document?
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-neutral-500 hover:text-neutral-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isPending}
                    className="rounded bg-red-900/60 px-2 py-0.5 text-xs font-medium text-red-300 hover:bg-red-900/80 disabled:opacity-40"
                  >
                    {isPending ? "Removing…" : "Confirm"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="text-[11px] text-red-500/60 hover:text-red-400"
                >
                  Delete generated graph
                </button>
              )}
            </div>
          )}

          {deleteResult && (
            <p className="mt-2 text-xs text-emerald-400">{deleteResult}</p>
          )}
        </div>
        <span
          className={[
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            status.className,
          ].join(" ")}
        >
          {status.label}
        </span>
      </div>
    </div>
  );
}
