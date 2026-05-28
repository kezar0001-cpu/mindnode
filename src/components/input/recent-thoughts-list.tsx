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
}: {
  entries: RecentMemoryEntry[];
}) {
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
        </li>
      ))}
    </ul>
  );
}
