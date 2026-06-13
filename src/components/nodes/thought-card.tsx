"use client";

import { useState } from "react";

import { categoryColour } from "@/lib/graph/insights";
import type { GraphNode } from "@/types";

export type NeighbourChip = {
  id: string;
  title: string;
  category: string;
};

export type TrailEntry = {
  id: string;
  content: string;
  created_at: string;
};

const trailFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

// Compact, mobile-first card for the selected thought on the 3D canvas.
// This is the default reading surface — everything the user needs to read a
// thought, see what it came from, and walk to a connected one — without a
// full-screen sheet that pulls them out of the 3D scene. The heavy editing
// UI (rename, delete, edge management) stays behind a subtle "Edit" link.
export function ThoughtCard({
  node,
  neighbours,
  trail,
  onHop,
  onAskAI,
  onEdit,
  onDelete,
  onClose,
}: {
  node: GraphNode;
  neighbours: NeighbourChip[];
  trail: TrailEntry[];
  onHop: (id: string) => void;
  onAskAI: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const colour = categoryColour(node.category || "general");
  const [showTrail, setShowTrail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="max-h-[56vh] overflow-y-auto rounded-2xl border border-canvas-border/80 bg-canvas-surface/95 p-4 shadow-lg shadow-black/40 backdrop-blur-md">
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

      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">
        {node.category || "general"}
      </p>

      {node.summary ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
          {node.summary}
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-neutral-500">
          No summary yet — open the memory trail below to see the original
          thoughts.
        </p>
      )}

      {neighbours.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Connected ({neighbours.length})
          </p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
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
        </div>
      )}

      {trail.length > 0 && (
        <div className="mt-3 border-t border-canvas-border/60 pt-2.5">
          <button
            type="button"
            onClick={() => setShowTrail((v) => !v)}
            className="flex w-full items-center justify-between text-left text-xs font-medium text-neutral-400 hover:text-neutral-200"
          >
            <span>
              Memory trail ({trail.length}) — the thoughts behind this
            </span>
            <span className={showTrail ? "rotate-180 transition-transform" : "transition-transform"}>
              ▾
            </span>
          </button>
          {showTrail && (
            <ul className="mt-2 space-y-2">
              {trail.map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg border border-canvas-border/60 bg-canvas-bg px-3 py-2"
                >
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-300">
                    {t.content}
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-600">
                    {trailFormatter.format(new Date(t.created_at))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmDelete ? (
        <div className="mt-3 flex items-center gap-2">
          <p className="flex-1 text-xs text-red-300">Delete this thought?</p>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="rounded-full px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full bg-red-900/70 px-4 py-2 text-xs font-medium text-red-200 hover:bg-red-900"
          >
            Delete
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onAskAI}
            className="flex-1 rounded-full bg-teal-600/90 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
          >
            Ask AI about this
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-full px-3 py-2 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete thought"
            title="Delete thought"
            className="rounded-full px-2.5 py-2 text-neutral-500 transition-colors hover:text-red-400"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M2 3.5h10M5 3.5V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M3 3.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
