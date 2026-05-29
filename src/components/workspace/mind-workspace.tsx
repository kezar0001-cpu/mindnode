"use client";

import { useState, useCallback, useEffect, useMemo } from "react";

import { Canvas, type GhostSuggestion } from "@/components/canvas/Canvas";
import { NodeDetail } from "@/components/nodes/node-detail";
import { ThoughtInputForm } from "@/components/input/thought-input-form";
import { RecentThoughtsList } from "@/components/input/recent-thoughts-list";
import { signOutAction } from "@/app/login/actions";
import { pinGhostSuggestionAction } from "@/lib/graph/actions";
import { deriveInsights, summarizeInsights, type Insight } from "@/lib/graph/insights";
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

type ActiveSheet = "composer" | "thoughts" | "detail" | "search" | "insights" | null;

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
  const [hideGhosts, setHideGhosts] = useState(false);

  // Insights derived from the in-memory graph.
  const insights = useMemo(
    () => deriveInsights(initialNodes, initialEdges),
    [initialNodes, initialEdges],
  );
  const insightSummary = useMemo(() => summarizeInsights(insights), [insights]);
  const insightCount = insights.length;

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

  // Shared explore fetch helper — wraps fetch + error handling.
  const callExplore = useCallback(
    async (body: {
      mode?: "explore" | "bridge" | "gap";
      selected_node_id?: string;
      exploration_context?: {
        ghost_id?: string;
        title: string;
        summary: string;
        category?: string;
        parent_ghost_id?: string;
        root_node_id?: string;
      };
      bridge_anchors?: { a_node_id: string; b_node_id: string };
      visible_ghost_titles: string[];
    }): Promise<ApiSuggestion[] | null> => {
      const res = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAiError(json.error ?? "Could not load suggestions.");
        return null;
      }
      const suggestions = (json.suggestions ?? []) as ApiSuggestion[];
      return suggestions;
    },
    [],
  );

  const handleSuggestAvenues = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const visible = ghosts.map((g) => g.title);
      const suggestions = await callExplore({
        selected_node_id: selectedNodeId ?? undefined,
        visible_ghost_titles: visible,
      });

      if (!suggestions) return;

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
  }, [selectedNodeId, initialNodes, ghosts, callExplore]);

  const handleGhostExplore = useCallback(
    async (ghostId: string) => {
      const parent = ghosts.find((g) => g.id === ghostId);
      if (!parent) return;
      setAiLoading(true);
      setAiError(null);
      try {
        const visible = ghosts.map((g) => g.title);
        const suggestions = await callExplore({
          exploration_context: {
            ghost_id: parent.id,
            title: parent.title,
            summary: parent.summary,
            category: parent.category,
            parent_ghost_id: parent.id,
            root_node_id: parent.root_node_id,
          },
          visible_ghost_titles: visible,
        });

        if (!suggestions) return;

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
    [ghosts, callExplore],
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
        ai_reason: ghost.reason,
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

  // Insight action handler — dispatches explore call based on insight kind.
  const handleInsightAction = useCallback(
    async (insight: Insight) => {
      setAiLoading(true);
      setAiError(null);
      try {
        const visible = ghosts.map((g) => g.title);
        switch (insight.kind) {
          case "isolated": {
            const node = insight.node;
            const suggestions = await callExplore({
              mode: "gap",
              selected_node_id: node.id,
              visible_ghost_titles: visible,
            });
            if (!suggestions || suggestions.length === 0) {
              setAiError("No avenues found for this isolated thought.");
              return;
            }
            const positions = positionGhosts(
              suggestions.length,
              node.position_x,
              node.position_y,
            );
            const ts = Date.now();
            const newGhosts: GhostSuggestion[] = suggestions.map((s, i) => ({
              ...s,
              id: `ghost-${ts}-${i}`,
              anchor_type: "real_node",
              anchor_node_id: node.id,
              root_node_id: node.id,
              x: positions[i].x,
              y: positions[i].y,
            }));
            setGhosts((prev) => [...prev, ...newGhosts]);
            setActiveSheet(null);
            break;
          }
          case "hub": {
            handleNodeSelect(insight.node.id);
            break;
          }
          case "small_cluster":
          case "duplicate_title": {
            if (insight.nodes.length > 0) {
              handleNodeSelect(insight.nodes[0].id);
            }
            break;
          }
          case "bridge_candidate": {
            const { a, b } = insight;
            const suggestions = await callExplore({
              mode: "bridge",
              bridge_anchors: { a_node_id: a.id, b_node_id: b.id },
              visible_ghost_titles: visible,
            });
            if (!suggestions || suggestions.length === 0) {
              setAiError("No bridge suggestions found between these thoughts.");
              return;
            }
            const positions = positionGhosts(
              suggestions.length,
              a.position_x,
              a.position_y,
            );
            const ts = Date.now();
            const newGhosts: GhostSuggestion[] = suggestions.map((s, i) => ({
              ...s,
              id: `ghost-${ts}-${i}`,
              anchor_type: "real_node",
              anchor_node_id: a.id,
              root_node_id: a.id,
              x: positions[i].x,
              y: positions[i].y,
            }));
            setGhosts((prev) => [...prev, ...newGhosts]);
            setActiveSheet(null);
            break;
          }
        }
      } catch (err) {
        setAiError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setAiLoading(false);
      }
    },
    [ghosts, callExplore, handleNodeSelect],
  );

  const sheetOpen = activeSheet !== null;
  const suggestLabel = aiLoading
    ? "Thinking…"
    : selectedNodeId
      ? "Explore this"
      : "Suggest avenues";

  // Ghosts passed to canvas — hidden when user toggled off.
  const visibleGhosts = hideGhosts ? [] : ghosts;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Canvas
          dbNodes={initialNodes}
          dbEdges={initialEdges}
          selectedNodeId={selectedNodeId}
          onNodeSelect={handleNodeSelect}
          ghostSuggestions={visibleGhosts}
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
          {insightCount > 0 && (
            <button
              type="button"
              onClick={() => openSheet("insights")}
              className="rounded-full border border-teal-400/40 bg-teal-950/30 px-3 py-1.5 text-xs font-medium text-teal-200 hover:bg-teal-950/50"
            >
              Insights ({insightCount})
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

      {/* Graph control mini-tray — bottom-left, mirrors FAB position */}
      <div className="fixed bottom-6 left-5 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setHideGhosts((h) => !h)}
          aria-label={hideGhosts ? "Show ghosts" : "Hide ghosts"}
          title={hideGhosts ? "Show AI suggestions" : "Hide AI suggestions"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-canvas-border bg-canvas-surface text-neutral-400 shadow-md hover:text-neutral-100"
        >
          {hideGhosts ? (
            /* eye-off */
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M2 2L13 13M6.2 6.3A2 2 0 0 0 8.7 8.8M4 4.4C2.6 5.4 1.5 6.6 1 7.5c1.3 2.5 3.8 4.5 6.5 4.5 1.2 0 2.3-.3 3.3-.9M9.5 3.8C8.9 3.3 8.2 3 7.5 3 4.8 3 2.3 5 1 7.5c.5.9 1.3 1.7 2.2 2.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            /* eye */
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M1 7.5C2.3 5 4.8 3 7.5 3S12.7 5 14 7.5C12.7 10 10.2 12 7.5 12S2.3 10 1 7.5Z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>
        {ghosts.length > 0 && (
          <button
            type="button"
            onClick={handleClearGhosts}
            aria-label="Clear all AI suggestions"
            title="Clear all AI suggestions"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-canvas-border bg-canvas-surface text-neutral-400 shadow-md hover:text-red-300"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M1 1l11 11M12 1L1 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

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

      <BottomSheet
        open={activeSheet === "insights"}
        onClose={() => setActiveSheet(null)}
        title={`Insights (${insightCount})`}
      >
        <InsightsSheet
          insights={insights}
          insightSummary={insightSummary}
          aiLoading={aiLoading}
          onInsightAction={handleInsightAction}
          onSelectNode={handleNodeSelect}
        />
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsightsSheet — renders the insights list inside the bottom sheet.
// ---------------------------------------------------------------------------

type InsightSummary = ReturnType<typeof summarizeInsights>;

function InsightsSheet({
  insights,
  insightSummary,
  aiLoading,
  onInsightAction,
  onSelectNode,
}: {
  insights: Insight[];
  insightSummary: InsightSummary;
  aiLoading: boolean;
  onInsightAction: (insight: Insight) => void;
  onSelectNode: (id: string) => void;
}) {
  if (insights.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No insights yet. Keep adding thoughts to grow your graph.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="flex flex-wrap gap-2">
        {insightSummary.isolated > 0 && (
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400">
            {insightSummary.isolated} isolated
          </span>
        )}
        {insightSummary.hub > 0 && (
          <span className="rounded-full border border-teal-700/40 px-2 py-0.5 text-[10px] text-teal-400">
            {insightSummary.hub} hub{insightSummary.hub > 1 ? "s" : ""}
          </span>
        )}
        {insightSummary.small_cluster > 0 && (
          <span className="rounded-full border border-blue-700/40 px-2 py-0.5 text-[10px] text-blue-400">
            {insightSummary.small_cluster} cluster{insightSummary.small_cluster > 1 ? "s" : ""}
          </span>
        )}
        {insightSummary.bridge_candidate > 0 && (
          <span className="rounded-full border border-amber-700/40 px-2 py-0.5 text-[10px] text-amber-400">
            {insightSummary.bridge_candidate} bridge{insightSummary.bridge_candidate > 1 ? "s" : ""}
          </span>
        )}
        {insightSummary.duplicate_title > 0 && (
          <span className="rounded-full border border-rose-700/40 px-2 py-0.5 text-[10px] text-rose-400">
            {insightSummary.duplicate_title} duplicate{insightSummary.duplicate_title > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Individual insight cards */}
      {insights.map((insight) => (
        <InsightCard
          key={insight.id}
          insight={insight}
          aiLoading={aiLoading}
          onAction={() => onInsightAction(insight)}
          onSelectNode={onSelectNode}
        />
      ))}
    </div>
  );
}

function InsightCard({
  insight,
  aiLoading,
  onAction,
  onSelectNode,
}: {
  insight: Insight;
  aiLoading: boolean;
  onAction: () => void;
  onSelectNode: (id: string) => void;
}) {
  switch (insight.kind) {
    case "isolated":
      return (
        <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
          <p className="text-xs text-neutral-400">Isolated thought</p>
          <p className="mt-0.5 line-clamp-1 text-sm font-medium text-neutral-200">
            {insight.node.title}
          </p>
          <button
            type="button"
            onClick={onAction}
            disabled={aiLoading}
            className="mt-2 rounded-full border border-teal-400/40 bg-teal-950/30 px-3 py-1 text-[11px] font-medium text-teal-200 hover:bg-teal-950/60 disabled:opacity-50"
          >
            Find avenues
          </button>
        </div>
      );

    case "hub":
      return (
        <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
          <p className="text-xs text-neutral-400">Hub</p>
          <p className="mt-0.5 line-clamp-1 text-sm font-medium text-neutral-200">
            {insight.node.title}
            <span className="ml-1 text-xs text-neutral-500">
              ({insight.degree} connections)
            </span>
          </p>
          <button
            type="button"
            onClick={onAction}
            className="mt-2 rounded-full border border-teal-400/40 bg-teal-950/30 px-3 py-1 text-[11px] font-medium text-teal-200 hover:bg-teal-950/60"
          >
            Focus
          </button>
        </div>
      );

    case "small_cluster":
      return (
        <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
          <p className="text-xs text-neutral-400">
            Small cluster · {insight.nodes.length} thoughts
          </p>
          <ul className="mt-1.5 space-y-1">
            {insight.nodes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(n.id)}
                  className="line-clamp-1 text-left text-sm text-neutral-300 hover:text-teal-300"
                >
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );

    case "duplicate_title":
      return (
        <div className="rounded-lg border border-rose-500/20 bg-rose-950/10 p-3">
          <p className="text-xs text-rose-400/80">
            Possible duplicate · {insight.nodes.length} thoughts
          </p>
          <ul className="mt-1.5 space-y-1">
            {insight.nodes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(n.id)}
                  className="line-clamp-1 text-left text-sm text-neutral-300 hover:text-rose-300"
                >
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );

    case "bridge_candidate":
      return (
        <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3">
          <p className="text-xs text-amber-400/80">Bridge candidate</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium text-neutral-200">
            {insight.a.title}
            <span className="mx-1 text-neutral-500">↔</span>
            {insight.b.title}
          </p>
          <button
            type="button"
            onClick={onAction}
            disabled={aiLoading}
            className="mt-2 rounded-full border border-amber-400/40 bg-amber-950/30 px-3 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-950/60 disabled:opacity-50"
          >
            Suggest bridge
          </button>
        </div>
      );
  }
}
