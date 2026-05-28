export default function HomePage() {
  return (
    <div className="flex h-screen w-screen flex-col">
      <header className="flex items-center border-b border-canvas-border bg-canvas-surface px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">MindNode</h1>
        <span className="ml-3 text-xs uppercase tracking-wider text-neutral-500">
          personal memory canvas
        </span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          aria-label="Thought input"
          className="flex w-80 flex-col border-r border-canvas-border bg-canvas-surface p-4"
        >
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
            Thought input
          </h2>
          <p className="text-sm text-neutral-500">
            The chat-style input panel will live here.
          </p>
        </aside>

        <section
          aria-label="Canvas"
          className="relative flex flex-1 items-center justify-center bg-canvas-bg"
        >
          <p className="text-sm text-neutral-500">
            Canvas will render here once the graph is wired up.
          </p>
        </section>

        <aside
          aria-label="Node detail"
          className="w-96 border-l border-canvas-border bg-canvas-surface p-4"
        >
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
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
