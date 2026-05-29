"use client";

import { useEffect, useRef, useState } from "react";

type UploadStage =
  | "idle"
  | "uploading"
  | "extracting"
  | "reading"
  | "graph"
  | "done"
  | "error";

type UploadResultDetails = {
  sectionsCreated: number;
  chunksCreated: number;
  nodesCreated: number;
  edgesCreated: number;
  existingNodesLinked: number;
  duplicatesSkipped: number;
  processingReport: string;
  warningsCount: number;
  finalStatus: string;
};

type UploadState =
  | { status: "idle" }
  | {
      status: "working";
      stage: Exclude<UploadStage, "idle" | "done" | "error">;
    }
  | { status: "success"; message: string; details: UploadResultDetails }
  | { status: "error"; message: string };

const ACCEPT =
  ".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_BYTES = 10 * 1024 * 1024;

type UploadResponse = {
  ok: boolean;
  document_id?: string;
  document_root_node_id?: string | null;
  notes_created?: number;
  section_count?: number;
  chunk_count?: number;
  nodes_created?: number;
  edges_created?: number;
  existing_nodes_linked?: number;
  duplicates_skipped?: number;
  processing_report?: string;
  warnings_count?: number;
  warnings?: string[];
  status?: string;
  error?: string;
};

const STAGE_LABEL: Record<
  Exclude<UploadStage, "idle" | "done" | "error">,
  string
> = {
  uploading: "Uploading…",
  extracting: "Extracting text…",
  reading: "Reading sections…",
  graph: "Building graph…",
};

export function DocumentUploadSheet({
  onSuccess,
}: {
  onSuccess?: (result: {
    documentId: string;
    documentRootNodeId: string | null;
    nodesCreated: number;
    edgesCreated: number;
    existingNodesLinked: number;
    duplicatesSkipped: number;
    processingReport: string;
    warningsCount: number;
    filename: string;
    sectionCount: number;
    chunkCount: number;
    status: string;
  }) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const isWorking = state.status === "working";

  useEffect(() => {
    if (state.status !== "working") return;
    const stages: Exclude<UploadStage, "idle" | "done" | "error">[] = [
      "uploading",
      "extracting",
      "reading",
      "graph",
    ];
    const delays = [1500, 2500, 3000];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let idx = stages.indexOf(state.stage);
    let totalDelay = 0;
    for (let i = idx; i < stages.length - 1; i++) {
      totalDelay += delays[i];
      const next = stages[i + 1];
      timers.push(
        setTimeout(() => {
          setState((s) =>
            s.status === "working" ? { status: "working", stage: next } : s,
          );
        }, totalDelay),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [state]);

  async function handleUpload(file: File) {
    if (file.size > MAX_BYTES) {
      setState({
        status: "error",
        message: "File is too large. Maximum 10MB.",
      });
      return;
    }

    setState({ status: "working", stage: "uploading" });

    const formData = new FormData();
    formData.append("file", file);

    let response: Response;
    try {
      response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
    } catch (error) {
      console.error("[documents/upload] fetch failed", error);
      setState({
        status: "error",
        message: "Network error. Please try again.",
      });
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    console.info("[documents/upload] response.status", response.status);
    console.info("[documents/upload] response.headers content-type", contentType);

    let rawText = "";
    try {
      rawText = await response.text();
      console.info("[documents/upload] raw response text", rawText);
    } catch (error) {
      console.error("[documents/upload] failed to read response text", error);
      setState({
        status: "error",
        message: `Could not read server response (HTTP ${response.status}). Please try again.`,
      });
      return;
    }

    let body: UploadResponse;
    try {
      body = JSON.parse(rawText) as UploadResponse;
      console.info("[documents/upload] parsed payload", body);
    } catch (error) {
      console.error("[documents/upload] response was not valid JSON", error);
      const preview = rawText.slice(0, 300) || "<empty response>";
      setState({
        status: "error",
        message: `Server returned a non-JSON response (HTTP ${response.status}). Preview: ${preview}.`,
      });
      return;
    }

    if (!response.ok || !body.ok) {
      setState({
        status: "error",
        message:
          body.error ??
          `Could not process the document (HTTP ${response.status}).`,
      });
      return;
    }

    const nodesCreated = body.nodes_created ?? 0;
    const edgesCreated = body.edges_created ?? 0;
    const warningsCount = body.warnings_count ?? body.warnings?.length ?? 0;
    const sectionCount = body.section_count ?? 0;
    const chunkCount = body.chunk_count ?? 0;
    const existingNodesLinked = body.existing_nodes_linked ?? 0;
    const duplicatesSkipped = body.duplicates_skipped ?? 0;
    const processingReport = body.processing_report ?? "";
    const finalStatus = body.status ?? "processed";
    const processedWithWarnings =
      finalStatus === "processed_with_warnings" || warningsCount > 0;
    const message = processedWithWarnings
      ? `Processed with warnings.`
      : nodesCreated > 0
        ? `Processed successfully.`
        : `Saved, but no nodes were created.`;

    setState({
      status: "success",
      message,
      details: {
        sectionsCreated: sectionCount,
        chunksCreated: chunkCount,
        nodesCreated,
        edgesCreated,
        existingNodesLinked,
        duplicatesSkipped,
        processingReport,
        warningsCount,
        finalStatus,
      },
    });
    onSuccess?.({
      documentId: body.document_id ?? "",
      documentRootNodeId: body.document_root_node_id ?? null,
      nodesCreated,
      edgesCreated,
      existingNodesLinked,
      duplicatesSkipped,
      processingReport,
      warningsCount,
      filename: file.name,
      sectionCount,
      chunkCount,
      status: finalStatus,
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-400">
        Upload a .txt, .md, .pdf, or .docx file. AI reads every section and
        builds a knowledge graph. Large documents produce 20–80 nodes. Limit: 10MB.
      </p>

      <label
        className={[
          "flex flex-col items-center justify-center gap-2 rounded-lg",
          "border border-dashed border-canvas-border bg-canvas-bg px-4 py-6",
          "text-center transition-colors",
          isWorking ? "opacity-60" : "cursor-pointer hover:border-teal-300/50",
        ].join(" ")}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 16V4M12 4L7 9M12 4l5 5M4 20h16"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-neutral-300"
          />
        </svg>
        <span className="text-sm font-medium text-neutral-200">
          {isWorking ? STAGE_LABEL[state.stage] : "Choose a file"}
        </span>
        <span className="text-xs text-neutral-500">
          .txt · .md · .pdf · .docx
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={isWorking}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
      </label>

      {isWorking && (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-teal-300" />
          <span>
            {STAGE_LABEL[state.stage]} Large files can take 60–120 seconds.
          </span>
        </div>
      )}

      {state.status === "success" && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <p className="font-medium">{state.message}</p>
          {state.details.processingReport && (
            <p className="mt-1 text-[11px] text-emerald-100/70">
              {state.details.processingReport}
            </p>
          )}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-emerald-100/80">
            <div>
              <dt className="text-neutral-400">Sections</dt>
              <dd>{state.details.sectionsCreated}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Chunks</dt>
              <dd>{state.details.chunksCreated}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Nodes created</dt>
              <dd>{state.details.nodesCreated}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Edges created</dt>
              <dd>{state.details.edgesCreated}</dd>
            </div>
            {state.details.existingNodesLinked > 0 && (
              <div>
                <dt className="text-neutral-400">Linked existing</dt>
                <dd>{state.details.existingNodesLinked}</dd>
              </div>
            )}
            {state.details.duplicatesSkipped > 0 && (
              <div>
                <dt className="text-neutral-400">Duplicates skipped</dt>
                <dd>{state.details.duplicatesSkipped}</dd>
              </div>
            )}
            {state.details.warningsCount > 0 && (
              <div className="col-span-2">
                <dt className="text-neutral-400">Warnings</dt>
                <dd className="text-amber-300">{state.details.warningsCount}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {state.status === "error" && (
        <p className="rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          {state.message}
        </p>
      )}
    </div>
  );
}
