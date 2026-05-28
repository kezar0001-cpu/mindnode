"use client";

import { useState, useTransition } from "react";

import { createNodeFromMemoryAction } from "@/lib/graph/actions";
import type { RecentMemoryEntry } from "@/lib/memory/queries";

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(iso: string): string {
  return timestampFormatter.format(new Date(iso));
}

export function RecentThoughtsList({
  entries,
  promotedMemoryIds,
}: {
  entries: RecentMemoryEntry[];
  promotedMemoryIds: string[];
}) {
  const promotedSet = new Set(promotedMemoryIds);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const handleAddToCanvas = (memoryId: string) => {
    if (pendingId) return;
    setPendingId(memoryId);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[memoryId];
      return next;
    });
    startTransition(async () => {
      const result = await createNodeFromMemoryAction(memoryId);
      setPendingId(null);
      if (!result.success && result.error !== "already_on_canvas") {
        setErrors((prev) => ({
          ...prev,
          [memoryId]: result.error ?? "Something went wrong.",
        }));
      }
    });
  };

  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">No thoughts saved yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => {
        const isPromoted = promotedSet.has(entry.id);
        const isPending = pendingId === entry.id;
        const error = errors[entry.id];

        return (
          <li
            key={entry.id}
            className="rounded border border-canvas-border bg-canvas-bg p-3"
          >
            <p className="whitespace-pre-wrap break-words text-sm text-neutral-100">
              {entry.content}
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              {formatTimestamp(entry.created_at)}
            </p>

            {error && (
              <p className="mt-1.5 text-xs text-red-400">{error}</p>
            )}

            <div className="mt-2">
              {isPromoted ? (
                <span className="text-xs text-neutral-600">On canvas</span>
              ) : (
                <button
                  type="button"
                  disabled={!!pendingId}
                  onClick={() => handleAddToCanvas(entry.id)}
                  className="text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-40"
                >
                  {isPending ? "Adding…" : "+ Add to canvas"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
