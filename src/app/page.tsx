import { RecentThoughtsList } from "@/components/input/recent-thoughts-list";
import { ThoughtInputForm } from "@/components/input/thought-input-form";
import { MindWorkspace } from "@/components/workspace/mind-workspace";
import { listRecentMemoryEntries } from "@/lib/memory/queries";
import {
  listEdges,
  listNodeMemoryTrails,
  listNodes,
} from "@/lib/graph/queries";
import { requireUser } from "@/lib/supabase/auth";

import { signOutAction } from "./login/actions";

// Reads auth cookies on every request; never prerender.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

  const [recent, nodes, edges] = await Promise.all([
    listRecentMemoryEntries(20),
    listNodes(),
    listEdges(),
  ]);

  const memoryTrails = await listNodeMemoryTrails(nodes.map((n) => n.id));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-canvas-border bg-canvas-surface px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">MindNode</h1>
          <span className="hidden text-xs uppercase tracking-wider text-neutral-500 sm:inline">
            personal memory canvas
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden max-w-[12rem] truncate text-xs text-neutral-500 sm:inline">
            {user.email}
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded border border-canvas-border px-3 py-2 text-sm text-neutral-300 hover:border-neutral-400"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside
          aria-label="Thought input"
          className="flex flex-col gap-6 border-b border-canvas-border bg-canvas-surface p-4 sm:p-5 lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
        >
          <section>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
              Capture a thought
            </h2>
            <ThoughtInputForm />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
              Recent thoughts
            </h2>
            <RecentThoughtsList entries={recent} />
          </section>
        </aside>

        <MindWorkspace
          initialNodes={nodes}
          initialEdges={edges}
          memoryTrails={memoryTrails}
        />
      </div>
    </div>
  );
}
