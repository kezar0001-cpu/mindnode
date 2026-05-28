export default function HomePage() {
  return (
    <main className="flex h-screen w-screen">
      <aside className="flex w-80 flex-col border-r border-canvas-border bg-canvas-surface p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Thought input
        </h2>
        <p className="text-sm text-neutral-500">
          The chat-style input panel will live here.
        </p>
      </aside>

      <section className="relative flex flex-1 items-center justify-center bg-canvas-bg">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-semibold">MindNode</h1>
          <p className="text-sm text-neutral-500">
            Canvas will render here once the graph is wired up.
          </p>
        </div>
      </section>

      <aside className="w-96 border-l border-canvas-border bg-canvas-surface p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Node detail
        </h2>
        <p className="text-sm text-neutral-500">
          Selected node summary and memory trail will appear here.
        </p>
      </aside>
    </main>
  );
}
