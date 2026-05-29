"use client";

import { useRef, useState } from "react";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const ACCEPT =
  ".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_BYTES = 10 * 1024 * 1024;

type UploadResponse = {
  ok: boolean;
  document_id?: string;
  notes_created?: number;
  error?: string;
};

export function DocumentUploadSheet({
  onSuccess,
}: {
  onSuccess?: (result: {
    documentId: string;
    notesCreated: number;
    filename: string;
  }) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const isWorking = state.status === "uploading";

  async function handleUpload(file: File) {
    if (file.size > MAX_BYTES) {
      setState({ status: "error", message: "File is too large. Maximum 10MB." });
      return;
    }

    setState({ status: "uploading" });

    const formData = new FormData();
    formData.append("file", file);

    let response: Response;
    try {
      response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
    } catch {
      setState({
        status: "error",
        message: "Network error. Please try again.",
      });
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

    const notesCreated = body.notes_created ?? 0;
    setState({
      status: "success",
      message:
        notesCreated > 0
          ? `Added ${notesCreated} note${notesCreated === 1 ? "" : "s"} from ${file.name}`
          : `Saved ${file.name}, but no notes were created.`,
    });
    onSuccess?.({
      documentId: body.document_id ?? "",
      notesCreated,
      filename: file.name,
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-400">
        Upload a .txt, .md, .pdf, or .docx file. The AI reads it and adds new
        notes to your graph. Limit: 10MB.
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
          {isWorking ? "Uploading and processing…" : "Choose a file"}
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
        <p className="text-xs text-neutral-400">
          Uploading… this can take 30 seconds for large files.
        </p>
      )}

      {state.status === "success" && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          {state.message}
        </p>
      )}

      {state.status === "error" && (
        <p className="rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          {state.message}
        </p>
      )}
    </div>
  );
}
