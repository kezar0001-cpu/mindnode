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

type UploadState =
  | { status: "idle" }
  | { status: "working"; stage: Exclude<UploadStage, "idle" | "done" | "error"> }
  | { status: "success"; message: string; warnings: number }
  | { status: "error"; message: string };

const ACCEPT =
  ".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_BYTES = 10 * 1024 * 1024;

type UploadResponse = {
  ok: boolean;
  document_id?: string;
  notes_created?: number;
  section_count?: number;
  chunk_count?: number;
  nodes_created?: number;
  edges_created?: number;
  warnings_count?: number;
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
    nodesCreated: number;
    edgesCreated: number;
    warningsCount: number;
    filename: string;
  }) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const isWorking = state.status === "working";

  // Stage cycler — advance the visible label while the upload is in flight.
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
          setState((s) => (s.status === "working" ? { status: "working", stage: next } : s));
        }, totalDelay),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [state]);

  async function handleUpload(file: File) {
    if (file.size > MAX_BYTES) {
      setState({ status: "error", message: "File is too large. Maximum 10MB." });
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
    } catch {
      setState({ status: "error", message: "Network error. Please try again." });
      return;
    }

    let body: UploadResponse;
    try {
      body = (await response.json()) as UploadResponse;
    } catch {
      setState({
        status: "error",
        message: "Server returned an unexpected response.",
      });
      return;
    }

    if (!response.ok || !body.ok) {
      setState({
        status: "error",
        message: body.error ?? "Could not process the document.",
      });
      return;
    }

    const nodesCreated = body.nodes_created ?? 0;
    const edgesCreated = body.edges_created ?? 0;
    const warningsCount = body.warnings_count ?? 0;
    const message =
      nodesCreated > 0
        ? `Added ${nodesCreated} node${nodesCreated === 1 ? "" : "s"} and ${edgesCreated} connection${edgesCreated === 1 ? "" : "s"} from ${file.name}`
        : `Saved ${file.name}, but no nodes were created.`;
    setState({ status: "success", message, warnings: warningsCount });
    onSuccess?.({
      documentId: body.document_id ?? "",
      nodesCreated,
      edgesCreated,
      warningsCount,
      filename: file.name,
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-400">
        Upload a .txt, .md, .pdf, or .docx file. The AI reads it section by
        section and turns it into a knowledge graph. Limit: 10MB.
      </p>

      <label
        className={[
          "flex flex-col items-center justify-center gap-2 rounded-lg",
          "border border-dashed border-canvas-border bg-canvas-bg px-4 py-6",
          "text-center transition-colors",
          isWorking
            ? "opacity-60"
            : "cursor-pointer hover:border-teal-300/50",
        ].join(" ")}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
          <span>{STAGE_LABEL[state.stage]} this can take 30 to 60 seconds for large files.</span>
        </div>
      )}

      {state.status === "success" && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <p>{state.message}</p>
          {state.warnings > 0 && (
            <p className="mt-1 text-amber-300/90">
              {state.warnings} warning{state.warnings === 1 ? "" : "s"} during
              processing.
            </p>
          )}
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
