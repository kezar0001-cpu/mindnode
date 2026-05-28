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

function PromoteForm({
  memoryId,
  onCancel,
}: {
  memoryId: string;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = (fd.get("title") as string).trim();
    const category = ((fd.get("category") as string) || "").trim() || "general";
    setError(null);
    startTransition(async () => {
      const result = await createNodeFromMemoryAction(memoryId, title, category);
      if (!result.success) {
        setError(result.error ?? "Something went wrong.");
      }
      // On success, revalidatePath triggers a page refresh which unmounts this
      // component; no manual close needed.
    });
  };

  return (
    <form className="mt-3 space-y-2" onSubmit={handleSubmit}>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <input
        name="title"
        type="text"
        required
        autoFocus
        placeholder="Node title"
        className="block w-full rounded border border-canvas-border bg-canvas-surface px-2 py-1.5 text-base text-neutral-100 outline-none focus:border-neutral-400 sm:text-sm"
      />
      <input
        name="category"
        type="text"
        placeholder="Category (optional)"
        className="block w-full rounded border border-canvas-border bg-canvas-surface px-2 py-1.5 text-base text-neutral-100 outline-none focus:border-neutral-400 sm:text-sm"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-neutral-100 px-3 py-1.5 text-xs font-medium text-canvas-bg hover:bg-white disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Promote"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-canvas-border px-3 py-1.5 text-xs text-neutral-400 hover:border-neutral-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RecentThoughtsList({
  entries,
}: {
  entries: RecentMemoryEntry[];
}) {
  const [promotingId, setPromotingId] = useState<string | null>(null);

  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">No thoughts saved yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
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

          {promotingId === entry.id ? (
            <PromoteForm
              memoryId={entry.id}
              onCancel={() => setPromotingId(null)}
            />
          ) : (
            <button
              type="button"
              className="mt-2 text-xs text-neutral-500 hover:text-neutral-300"
              onClick={() => setPromotingId(entry.id)}
            >
              + promote to node
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
