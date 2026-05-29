"use client";

import type { SourceDocument } from "@/lib/graph/queries";

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
}: {
  document: SourceDocument;
}) {
  const type = fileLabel(document.mime_type, document.original_filename);
  const status = statusStyle(document.status);
  const hasCounts =
    document.section_count > 0 ||
    document.chunk_count > 0 ||
    document.nodes_created > 0 ||
    document.edges_created > 0;
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
