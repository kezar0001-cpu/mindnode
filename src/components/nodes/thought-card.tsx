"use client";

import { categoryColour } from "@/lib/graph/insights";
import type { GraphNode } from "@/types";

export type NeighbourChip = {
  id: string;
  title: string;
  category: string;
};

// Compact, mobile-first card for the selected thought on the 3D canvas.
// This is the default reading surface: enough to read the thought and walk
// to a connected one in a single tap, with the full editing UI (memory
// trail, edges, rename, delete) kept behind "Details".
export function ThoughtCard({
  node,
  neighbours,
  memoryCount,
  onHop,
  onAskAI,
  onDetails,
  onClose,
}: {
  node: GraphNode;
  neighbours: NeighbourChip[];
  memoryCount: number;
  onHop: (id: string) => void;
  onAskAI: () => void;
  onDetails: () => void;
  onClose: () => void;
}) {
  const colour = categoryColour(node.category || "general");

  return (
    <div className="rounded-2xl border border-canvas-border/80 bg-canvas-surface/95 p-4 shadow-lg shadow-black/40 backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colour.stroke }}
            aria-hidden="true"
          />
          <h2 className="truncate text-base font-semibold text-neutral-100">
            {node.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-1 shrink-0 p-1 text-neutral-500 hover:text-neutral-200"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M1 1l10 10M11 1L1 11"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-neutral-400">
        {node.summary}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        {node.category}
        {memoryCount > 0 &&
          ` · ${memoryCount} memor${memoryCount === 1 ? "y" : "ies"}`}
      </p>

      {neighbours.length > 0 && (
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {neighbours.map((n) => {
            const c = categoryColour(n.category || "general");
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onHop(n.id)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-canvas-border bg-canvas-bg px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.stroke }}
                  aria-hidden="true"
                />
                <span className="max-w-[10rem] truncate">{n.title}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onAskAI}
          className="flex-1 rounded-full bg-teal-600/90 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
        >
          Ask AI
        </button>
        <button
          type="button"
          onClick={onDetails}
          className="flex-1 rounded-full border border-canvas-border px-4 py-2 text-sm text-neutral-300 transition-colors hover:text-neutral-100"
        >
          Details
        </button>
      </div>
    </div>
  );
}
