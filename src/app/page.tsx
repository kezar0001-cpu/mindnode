import { requireUser } from "@/lib/supabase/auth";

import { signOutAction } from "./login/actions";

// Reads auth cookies on every request; never prerender.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

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
          className="flex flex-col gap-2 border-b border-canvas-border bg-canvas-surface p-4 sm:p-5 lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r"
        >
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Thought input
          </h2>
          <p className="text-sm text-neutral-500">
            The chat-style input panel will live here.
          </p>
        </aside>

        <section
          aria-label="Canvas"
          className="relative flex min-h-[55vh] flex-1 items-center justify-center bg-canvas-bg p-6 lg:min-h-0"
        >
          <p className="text-center text-sm text-neutral-500">
            Canvas will render here once the graph is wired up.
          </p>
        </section>

        <aside
          aria-label="Node detail"
          className="flex flex-col gap-2 border-t border-canvas-border bg-canvas-surface p-4 sm:p-5 lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
        >
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Node detail
          </h2>
          <p className="text-sm text-neutral-500">
            Selected node summary and memory trail will appear here.
          </p>
        </aside>
      </div>
    </div>
  );
}
