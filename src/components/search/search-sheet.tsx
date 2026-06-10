"use client";

import { useEffect, useRef, useState } from "react";

// Grouped global search over nodes, raw thoughts, and documents, backed by
// POST /api/search (hybrid vector + keyword). Results are fetched debounced
// as the user types.

type SearchNodeResult = {
  id: string;
  title: string;
  summary: string;
  category: string;
};

type SearchThoughtResult = {
  id: string;
  content: string;
  created_at: string;
  node_id: string | null;
};

type SearchDocumentResult = {
  document_id: string;
  filename: string;
  section_title: string | null;
  excerpt: string;
  root_node_id: string | null;
};

type SearchResults = {
  nodes: SearchNodeResult[];
  thoughts: SearchThoughtResult[];
  documents: SearchDocumentResult[];
};

const EMPTY_RESULTS: SearchResults = { nodes: [], thoughts: [], documents: [] };

export function SearchSheet({
  open,
  onSelectNode,
  onSuggestPlacement,
}: {
  open: boolean;
  // Focus a node on the canvas (closes the sheet via the parent handler).
  onSelectNode: (id: string) => void;
  // Open the AI capture-suggestion review for an un-promoted thought.
  onSuggestPlacement?: (memoryId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Reset when the sheet closes so it opens fresh next time.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(EMPTY_RESULTS);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  // Debounced fetch; stale responses are dropped via a sequence counter.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        const json = await res.json();
        if (seq !== requestSeq.current) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Search failed.");
          setResults(EMPTY_RESULTS);
        } else {
          setResults({
            nodes: json.nodes ?? [],
            thoughts: json.thoughts ?? [],
            documents: json.documents ?? [],
          });
        }
      } catch {
        if (seq === requestSeq.current) {
          setError("Network error.");
          setResults(EMPTY_RESULTS);
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const hasResults =
    results.nodes.length > 0 ||
    results.thoughts.length > 0 ||
    results.documents.length > 0;

  return (
    <div>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search thoughts, nodes, and documents…"
        className="block w-full rounded border border-canvas-border bg-canvas-bg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
      />

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {loading && (
        <p className="mt-3 text-xs text-neutral-500" aria-live="polite">
          Searching…
        </p>
      )}

      {!loading && !error && query.trim() && !hasResults && (
        <p className="mt-3 text-xs text-neutral-500">No matches.</p>
      )}

      {!query.trim() && (
        <p className="mt-3 text-xs text-neutral-500">
          Search everything you’ve captured — canvas nodes, raw thoughts, and
          uploaded documents.
        </p>
      )}

      {results.nodes.length > 0 && (
        <section className="mt-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            On the canvas
          </h3>
          <ul className="mt-2 space-y-2">
            {results.nodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className="block w-full rounded border border-canvas-border bg-canvas-bg p-3 text-left hover:border-teal-300/40"
                >
                  <p className="line-clamp-1 text-sm font-medium text-neutral-100">
                    {node.title}
                    <span className="ml-1.5 text-[10px] font-normal text-neutral-500">
                      {node.category}
                    </span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
                    {node.summary}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.thoughts.length > 0 && (
        <section className="mt-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Raw thoughts
          </h3>
          <ul className="mt-2 space-y-2">
            {results.thoughts.map((thought) => (
              <li
                key={thought.id}
                className="rounded border border-canvas-border bg-canvas-bg p-3"
              >
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-neutral-200">
                  {thought.content}
                </p>
                <div className="mt-2">
                  {thought.node_id ? (
                    <button
                      type="button"
                      onClick={() => onSelectNode(thought.node_id!)}
                      className="text-xs text-teal-300 hover:text-teal-200"
                    >
                      Show on canvas
                    </button>
                  ) : onSuggestPlacement ? (
                    <button
                      type="button"
                      onClick={() => onSuggestPlacement(thought.id)}
                      className="text-xs text-teal-300 hover:text-teal-200"
                    >
                      ✦ Add with AI
                    </button>
                  ) : (
                    <span className="text-xs text-neutral-600">Not on canvas</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.documents.length > 0 && (
        <section className="mt-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Documents
          </h3>
          <ul className="mt-2 space-y-2">
            {results.documents.map((doc) => (
              <li key={doc.document_id}>
                <button
                  type="button"
                  onClick={() => doc.root_node_id && onSelectNode(doc.root_node_id)}
                  disabled={!doc.root_node_id}
                  className="block w-full rounded border border-canvas-border bg-canvas-bg p-3 text-left enabled:hover:border-blue-300/40 disabled:cursor-default"
                >
                  <p className="line-clamp-1 text-sm font-medium text-neutral-100">
                    📄 {doc.filename}
                    {doc.section_title && (
                      <span className="ml-1.5 text-[10px] font-normal text-neutral-500">
                        {doc.section_title}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
                    {doc.excerpt}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
