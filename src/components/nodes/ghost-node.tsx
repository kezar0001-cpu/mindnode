"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type GhostNodeData = Record<string, unknown> & {
  title: string;
  category: string;
  reason: string;
  confidence: number;
  isSelectedGhost?: boolean;
  isActivePath?: boolean;
  isPathAncestor?: boolean;
  isPathChild?: boolean;
  isDimmed?: boolean;
  isPinned?: boolean;
  depth?: number;
  onExplore: () => void;
  onPin: () => void;
  onDismiss: () => void;
};

function confidenceDotColour(confidence: number): string {
  if (confidence >= 0.7) return "#4ade80"; // green
  if (confidence >= 0.5) return "#fbbf24"; // amber
  return "#94a3b8"; // slate
}

export function GhostNodeComponent({ data, selected }: NodeProps<Node<GhostNodeData>>) {
  const dotColour = confidenceDotColour(data.confidence ?? 0);
  const isSelectedGhost = Boolean(data.isSelectedGhost || selected);
  const isPathAncestor = Boolean(data.isPathAncestor);
  const isPathChild = Boolean(data.isPathChild);
  const isDimmed = Boolean(data.isDimmed);
  const isPinned = Boolean(data.isPinned);

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6, border: "none" }} />
      <div
        className={[
          "w-44 rounded-2xl border-2 border-dashed px-3 py-2.5 text-center transition-all",
          isSelectedGhost
            ? "border-purple-200 bg-purple-950/55 shadow-xl shadow-purple-400/30 scale-[1.04]"
            : isPathAncestor
              ? "border-purple-300/50 bg-purple-950/25 opacity-75 shadow-md shadow-purple-500/10"
              : isPathChild
                ? "border-purple-400/70 bg-purple-950/25 opacity-95 shadow-md shadow-purple-500/15"
                : isDimmed
                  ? "border-purple-500/25 bg-purple-950/10 opacity-35"
                  : "border-purple-400/60 bg-purple-950/20 opacity-90",
        ].join(" ")}
      >
        <p className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-purple-300/80">
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: dotColour,
              flexShrink: 0,
            }}
          />
          AI · {data.category}
        </p>
        <p className="line-clamp-2 text-xs font-medium leading-snug text-purple-100">
          {data.title}
        </p>
        {isSelectedGhost && (
          <div className="mt-2 flex justify-center gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); data.onExplore(); }}
              className="rounded-full bg-purple-300 px-2 py-0.5 text-[10px] font-medium text-purple-950 hover:bg-purple-200"
            >
              Explore
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!isPinned) data.onPin(); }}
              disabled={isPinned}
              className={[
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                isPinned
                  ? "cursor-default bg-teal-950/70 text-teal-200"
                  : "bg-teal-300 text-canvas-bg hover:bg-teal-200",
              ].join(" ")}
            >
              {isPinned ? "Pinned" : "Pin"}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); data.onDismiss(); }}
              aria-label="Dismiss"
              className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 hover:text-neutral-200"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6, border: "none" }} />
    </>
  );
}
