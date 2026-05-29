"use client";

import { useState, useCallback, useEffect, useMemo } from "react";

import { Canvas, type GhostSuggestion } from "@/components/canvas/Canvas";
import { NodeDetail } from "@/components/nodes/node-detail";
import { ThoughtInputForm } from "@/components/input/thought-input-form";
import { RecentThoughtsList } from "@/components/input/recent-thoughts-list";
import { signOutAction } from "@/app/login/actions";
import { pinGhostSuggestionAction } from "@/lib/graph/actions";
import type { GraphNode, GraphEdge } from "@/types";
import type { MemoryTrailMap } from "@/lib/graph/queries";
import type { RecentMemoryEntry } from "@/lib/memory/queries";

type MindWorkspaceProps = {
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  memoryTrails: MemoryTrailMap;
  recentEntries: RecentMemoryEntry[];
  promotedMemoryIds: string[];
  userEmail: string;
};

type ActiveSheet = "composer" | "thoughts" | "detail" | "search" | null;

type ApiSuggestion = {
  title: string;
  summary: string;
  category: string;
  relationship_type: string;
  reason: string;
  confidence: number;
};

function positionGhosts(
  count: number,
  anchorX: number,
  anchorY: number,
  radius = 240,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const safe = Math.max(count, 1);
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / safe - Math.PI / 2;
    out.push({
      x: anchorX + Math.cos(angle) * radius,
      y: anchorY + Math.sin(angle) * radius,
    });
  }
  return out;
}

function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "fixed bottom-0 left-0 right-0 z-40 flex flex-col",
        "rounded-t-2xl border-t border-canvas-border bg-canvas-surface",
        "transition-transform duration-300 ease-in-out",
        open ? "translate-y-0" : "translate-y-full",
      ].join(" ")}
      style={{ maxHeight: "75vh" }}
    >
      <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-700" />
      </div>
      <div className="flex shrink-0 items-center justify-between px-5 pb-3">
        <p className="text-sm font-semibold text-neutral-200">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 hover:text-neutral-200"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 1l10 10M11 1L1 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="overflow-y-auto px-5 pb-8">{children}</div>
    </div>
  );
}

export function MindWorkspace({
  initialNodes,
  initialEdges,
  memoryTrails,
  recentEntries,
  promotedMemoryIds,
  userEmail,
}: MindWorkspaceProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [ghosts, setGhosts] = useState<GhostSuggestion[]>([]);
  // ghostId -> real_node_id created when that ghost was pinned. Lets a
  // child ghost (whose parent has already been pinned) connect to the
  // parent's new real node instead of the original root.
  const [pinnedGhostMap, setPinnedGhostMap] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return initialNodes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.summary.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [initialNodes, searchQuery]);

  // When user selects a different real node, drop ghosts whose anchor
  // no longer matches. Pane-click (null) leaves ghosts alone.
  useEffect(() => {
    if (!selectedNodeId) return;
    setGhosts((prev) =>
      prev.filter((g) => {
        if (g.anchor_type === "real_node") return g.anchor_node_id === selectedNodeId;
        if (g.anchor_type === "ghost_node") return g.root_node_id === selectedNodeId;
        return false;
      }),
    );
  }, [selectedNodeId]);

  const openSheet = useCallback((sheet: ActiveSheet) => {
    setActiveSheet(sheet);
    if (sheet !== "detail") {
      setSelectedNodeId(null);
    }
  }, []);

  const closeSheet = useCallback(() => {
    setActiveSheet(null);
    setSelectedNodeId(null);
  }, []);

  const handleNodeSelect = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    if (id) {
      setActiveSheet("detail");
    } else {
      setActiveSheet(null);
    }
  }, []);

  const handleSuggestAvenues = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const visible = ghosts.map((g) => g.title);
      const body: {
        selected_node_id?: string;
        visible_ghost_titles: string[];
      } = { visible_ghost_titles: visible };
      if (selectedNodeId) body.selected_node_id = selectedNodeId;

      const res = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAiError(json.error ?? "Could not load suggestions.");
        return;
      }

      const suggestions = (json.suggestions ?? []) as ApiSuggestion[];
      if (suggestions.length === 0) {
        setAiError("No anchored avenues this time. Try again or refine the thought.");
        return;
      }

      let anchorX = 0;
      let anchorY = 0;
      if (selectedNodeId) {
        const sel = initialNodes.find((n) => n.id === selectedNodeId);
        if (sel) {
          anchorX = sel.position_x;
          anchorY = sel.position_y;
        }
      }

      const positions = positionGhosts(suggestions.length, anchorX, anchorY);
      const ts = Date.now();
      const newGhosts: GhostSuggestion[] = suggestions.map((s, i) => ({
        ...s,
        id: `ghost-${ts}-${i}`,
        anchor_type: selectedNodeId ? "real_node" : "graph",
        anchor_node_id: selectedNodeId ?? undefined,
        root_node_id: selectedNodeId ?? undefined,
        x: positions[i].x,
        y: positions[i].y,
      }));
      setGhosts(newGhosts);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAiLoading(false);
    }
  }, [selectedNodeId, initialNodes, ghosts]);

  const handleGhostExplore = useCallback(
    async (ghostId: string) => {
      const parent = ghosts.find((g) => g.id === ghostId);
      if (!parent) return;
      setAiLoading(true);
      setAiError(null);
      try {
        const visible = ghosts.map((g) => g.title);
        const body = {
          exploration_context: {
            ghost_id: parent.id,
            title: parent.title,
            summary: parent.summary,
            category: parent.category,
            parent_ghost_id: parent.id,
            root_node_id: parent.root_node_id,
          },
          visible_ghost_titles: visible,
        };

        const res = await fetch("/api/explore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setAiError(json.error ?? "Could not explore deeper.");
          return;
        }

        const suggestions = (json.suggestions ?? []) as ApiSuggestion[];
        if (suggestions.length === 0) {
          setAiError("No deeper avenues. Try a different angle.");
          return;
        }

        const positions = positionGhosts(suggestions.length, parent.x, parent.y, 200);
        const ts = Date.now();
        const children: GhostSuggestion[] = suggestions.map((s, i) => ({
          ...s,
          id: `ghost-${ts}-${i}`,
          anchor_type: "ghost_node",
          parent_ghost_id: parent.id,
          root_node_id: parent.root_node_id,
          x: positions[i].x,
          y: positions[i].y,
        }));
        // Keep parent visible; replace siblings with new children.
        setGhosts([parent, ...children]);
      } catch (err) {
        setAiError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setAiLoading(false);
      }
    },
    [ghosts],
  );

  const handleGhostPin = useCallback(
    async (ghostId: string) => {
      const ghost = ghosts.find((g) => g.id === ghostId);
      if (!ghost) return;
      setAiError(null);

      let sourceNodeId: string | undefined;
      if (ghost.anchor_type === "real_node") {
        sourceNodeId = ghost.anchor_node_id;
      } else if (ghost.anchor_type === "ghost_node") {
        // If the parent ghost has already been pinned, attach to its new real
        // node; otherwise fall back to the nearest real root.
        const parentReal =
          ghost.parent_ghost_id && pinnedGhostMap[ghost.parent_ghost_id];
        sourceNodeId = parentReal || ghost.root_node_id;
      }

      const result = await pinGhostSuggestionAction({
        title: ghost.title,
        summary: ghost.summary,
        category: ghost.category,
        source_node_id: sourceNodeId,
        relationship_type: ghost.relationship_type,
        position_x: ghost.x,
        position_y: ghost.y,
      });

      if (!result.success) {
        setAiError(result.error ?? "Could not pin to canvas.");
        return;
      }
      if (result.node_id) {
        setPinnedGhostMap((prev) => ({ ...prev, [ghost.id]: result.node_id! }));
      }
      setGhosts((prev) => prev.filter((g) => g.id !== ghostId));
    },
    [ghosts, pinnedGhostMap],
  );

  const handleClearGhosts = useCallback(() => {
    setGhosts([]);
  }, []);

  const handleGhostDismiss = useCallback((ghostId: string) => {
    setGhosts((prev) => prev.filter((g) => g.id !== ghostId));
  }, []);

  const sheetOpen = activeSheet !== null;
  const suggestLabel = aiLoading
    ? "Thinking…"
    : selectedNodeId
      ? "Explore this"
      : "Suggest avenues";

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Canvas
          dbNodes={initialNodes}
          dbEdges={initialEdges}
          selectedNodeId={selectedNodeId}
          onNodeSelect={handleNodeSelect}
          ghostSuggestions={ghosts}
          onGhostExplore={handleGhostExplore}
          onGhostPin={handleGhostPin}
          onGhostDismiss={handleGhostDismiss}
        />
      </div>

      <header
        className={[
          "fixed left-0 right-0 top-0 z-20",
          "flex items-center justify-between px-4 py-3",
          "bg-canvas-bg/70 backdrop-blur-md",
          "border-b border-canvas-border/50",
        ].join(" ")}
      >
        <p className="text-sm font-semibold tracking-tight text-neutral-100">
          MindNode
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSuggestAvenues}
            disabled={aiLoading}
            className="rounded-full border border-purple-400/40 bg-purple-950/30 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-950/50 disabled:opacity-50"
          >
            {suggestLabel}
          </button>
          {ghosts.length > 0 && (
            <button
              type="button"
              onClick={handleClearGhosts}
              title="Clear AI suggestions"
              className="rounded-full border border-canvas-border bg-canvas-surface px-2 py-1.5 text-[10px] font-medium text-neutral-400 hover:text-neutral-100"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => openSheet("search")}
            aria-label="Search"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-canvas-border bg-canvas-surface text-neutral-400 hover:text-neutral-100"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8.5 8.5L11.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => openSheet("thoughts")}
            className="rounded-full border border-canvas-border bg-canvas-surface px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-neutral-100"
          >
            Thoughts{recentEntries.length > 0 ? ` (${recentEntries.length})` : ""}
          </button>
          <form action={signOutAction}>
            <button
              type="submit"
              title={userEmail}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-neutral-400 hover:text-neutral-200"
            >
              {userEmail.charAt(0).toUpperCase()}
            </button>
          </form>
        </div>
      </header>

      {aiError && (
        <div className="fixed left-1/2 top-16 z-30 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/80 px-4 py-2 text-xs text-red-200 backdrop-blur">
          <span className="line-clamp-2">{aiError}</span>
          <button
            type="button"
            onClick={() => setAiError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-red-300 hover:text-red-100"
          >
            ×
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => openSheet("composer")}
        aria-label="Add thought"
        className={[
          "fixed bottom-6 right-5 z-20",
          "flex h-14 w-14 items-center justify-center",
          "rounded-full bg-neutral-100 shadow-lg shadow-black/50",
          "text-canvas-bg transition-all duration-200",
          sheetOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100",
        ].join(" ")}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path
            d="M11 4v14M4 11h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div
        onClick={closeSheet}
        className={[
          "fixed inset-0 z-30 bg-black/50",
          "transition-opacity duration-300",
          sheetOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
      />

      <BottomSheet
        open={activeSheet === "composer"}
        onClose={closeSheet}
        title="New thought"
      >
        <ThoughtInputForm onSuccess={closeSheet} />
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "thoughts"}
        onClose={closeSheet}
        title="Recent thoughts"
      >
        <RecentThoughtsList
          entries={recentEntries}
          promotedMemoryIds={promotedMemoryIds}
        />
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "detail"}
        onClose={closeSheet}
        title="Node detail"
      >
        <NodeDetail
          selectedNodeId={selectedNodeId}
          nodes={initialNodes}
          edges={initialEdges}
          memoryTrails={memoryTrails}
          onSelectNode={(id) => {
            setSelectedNodeId(id);
          }}
        />
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "search"}
        onClose={() => {
          setSearchQuery("");
          closeSheet();
        }}
        title="Search thoughts"
      >
        <input
          type="search"
          autoFocus
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search titles and thoughts…"
          className="block w-full rounded border border-canvas-border bg-canvas-bg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
        />
        {searchResults.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {searchResults.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    handleNodeSelect(node.id);
                  }}
                  className="block w-full rounded border border-canvas-border bg-canvas-bg p-3 text-left hover:border-teal-300/40"
                >
                  <p className="line-clamp-1 text-sm font-medium text-neutral-100">
                    {node.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
                    {node.summary}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-neutral-500">
            {searchQuery.trim()
              ? "No matches."
              : "Type to search your thoughts."}
          </p>
        )}
      </BottomSheet>
    </div>
  );
}
