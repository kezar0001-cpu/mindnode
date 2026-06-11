"use client";

import type { CaptureSuggestionResponse } from "@/lib/ai/suggest-schema";

// Review card for an AI capture suggestion: shows what the AI proposes to do
// with a just-captured thought (new node vs. update to an existing node),
// the structured title/summary/category, suggested connections, and why.
// Nothing is applied until the user accepts.

export type CaptureReviewState =
  | { phase: "loading"; memoryId: string }
  | { phase: "error"; memoryId: string; error: string }
  | { phase: "ready"; memoryId: string; data: CaptureSuggestionResponse }
  | { phase: "applying"; memoryId: string; data: CaptureSuggestionResponse };

function confidenceTone(confidence: number): string {
  if (confidence >= 0.7) return "bg-emerald-400";
  if (confidence >= 0.5) return "bg-amber-400";
  return "bg-neutral-500";
}

export function SuggestionReview({
  state,
  onAccept,
  onDismiss,
  onAddAsIs,
  onRetry,
  addAsIsPending,
}: {
  state: CaptureReviewState;
  onAccept: () => void;
  onDismiss: () => void;
  onAddAsIs: () => void;
  onRetry: () => void;
  addAsIsPending: boolean;
}) {
  if (state.phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-teal-300" />
        <p className="text-sm text-neutral-400">
          Finding where this belongs in your graph…
        </p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="space-y-4 py-2">
        <p className="text-sm text-red-300">
          {state.error === "already_on_canvas"
            ? "This thought is already on the canvas."
            : state.error}
        </p>
        {state.error !== "already_on_canvas" && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-teal-400/40 bg-teal-950/30 px-3 py-1.5 text-sm font-medium text-teal-200 hover:bg-teal-950/50"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onAddAsIs}
              disabled={addAsIsPending}
              className="rounded-md border border-canvas-border bg-canvas-bg px-3 py-1.5 text-sm text-neutral-300 hover:text-neutral-100 disabled:opacity-50"
            >
              {addAsIsPending ? "Adding…" : "Add to canvas as-is"}
            </button>
          </div>
        )}
        <p className="text-xs text-neutral-500">
          Your thought is saved either way — you can always find it under
          Recent thoughts.
        </p>
      </div>
    );
  }

  const { suggestion, target_node, edge_targets } = state.data;
  const applying = state.phase === "applying";
  const isUpdate = suggestion.action === "update_node" && target_node;

  return (
    <div className="space-y-4 py-1">
      {/* What the AI wants to do */}
      <div className="flex flex-wrap items-center gap-2">
        {isUpdate ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-950/30 px-2.5 py-0.5 text-[11px] font-medium text-amber-200">
            Update “{target_node.title}”
          </span>
        ) : (
          <span className="rounded-full border border-teal-400/40 bg-teal-950/30 px-2.5 py-0.5 text-[11px] font-medium text-teal-200">
            New thought on the canvas
          </span>
        )}
        <span className="rounded-full border border-canvas-border px-2 py-0.5 text-[10px] text-neutral-400">
          {suggestion.category}
        </span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${confidenceTone(suggestion.confidence)}`}
          title={`Confidence ${(suggestion.confidence * 100).toFixed(0)}%`}
        />
      </div>

      {/* Proposed node */}
      <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
        <p className="text-sm font-semibold text-neutral-100">{suggestion.title}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-neutral-300">
          {suggestion.summary}
        </p>
      </div>

      {/* Suggested connections */}
      {edge_targets.length > 0 && (
        <div>
          <p className="text-xs font-medium text-neutral-400">Suggested connections</p>
          <ul className="mt-1.5 space-y-1">
            {edge_targets.map((edge) => (
              <li key={edge.id} className="flex items-baseline gap-1.5 text-sm">
                <span className="text-neutral-500">→</span>
                <span className="text-neutral-200">{edge.title}</span>
                <span className="text-xs text-neutral-500">
                  {edge.relationship_type}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Why */}
      <p className="text-xs leading-relaxed text-neutral-500">
        {suggestion.explanation}
      </p>

      {/* Decisions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onAccept}
          disabled={applying}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-canvas-bg hover:bg-white disabled:opacity-60"
        >
          {applying ? "Applying…" : "Accept"}
        </button>
        <button
          type="button"
          onClick={onAddAsIs}
          disabled={applying || addAsIsPending}
          className="rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-sm text-neutral-300 hover:text-neutral-100 disabled:opacity-50"
        >
          {addAsIsPending ? "Adding…" : "Add as-is"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={applying}
          className="px-2 py-2 text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
