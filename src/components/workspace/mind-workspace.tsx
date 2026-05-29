"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";

import { Canvas, type GhostSuggestion } from "@/components/canvas/Canvas";
import { NodeDetail } from "@/components/nodes/node-detail";
import { ThoughtInputForm } from "@/components/input/thought-input-form";
import { RecentThoughtsList } from "@/components/input/recent-thoughts-list";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUploadSheet } from "@/components/documents/document-upload-sheet";
import { signOutAction } from "@/app/login/actions";
import { pinGhostSuggestionAction } from "@/lib/graph/actions";
import { deriveInsights, summarizeInsights, type Insight } from "@/lib/graph/insights";
import type { GraphNode, GraphEdge } from "@/types";
import type {
  MemoryTrailMap,
  NodeDocumentSource,
  SourceDocument,
} from "@/lib/graph/queries";
import type { RecentMemoryEntry } from "@/lib/memory/queries";
import { useRouter } from "next/navigation";

type MindWorkspaceProps = {
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  memoryTrails: MemoryTrailMap;
  recentEntries: RecentMemoryEntry[];
  promotedMemoryIds: string[];
  sourceDocuments: SourceDocument[];
  nodeDocumentSources: Record<string, NodeDocumentSource>;
  userEmail: string;
};

type ActiveSheet =
  | "composer"
  | "thoughts"
  | "detail"
  | "search"
  | "insights"
  | "documents"
  | "upload"
  | null;

type ApiSuggestion = {
  title: string;
  summary: string;
  category: string;
  relationship_type: string;
  reason: string;
  confidence: number;
};

type GhostPathState = {
  activeRootNodeId: string | null;
  activeGhostPathIds: string[];
  selectedGhostId: string | null;
};

const emptyGhostPathState: GhostPathState = {
  activeRootNodeId: null,
  activeGhostPathIds: [],
  selectedGhostId: null,
};

function deriveGhostPath(ghosts: GhostSuggestion[], ghostId: string): string[] {
  const byId = new Map(ghosts.map((g) => [g.id, g]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(ghostId);

  while (current && !seen.has(current.id)) {
    path.unshift(current.id);
    seen.add(current.id);
    current = current.parent_ghost_id ? byId.get(current.parent_ghost_id) : undefined;
  }

  return path;
}

function getGhostPathState(ghosts: GhostSuggestion[], ghostId: string): GhostPathState {
  const selected = ghosts.find((g) => g.id === ghostId);
  if (!selected) return emptyGhostPathState;

  const pathIds = selected.path_ids && selected.path_ids.length > 0
    ? selected.path_ids
    : deriveGhostPath(ghosts, ghostId);

  return {
    activeRootNodeId: selected.root_node_id ?? selected.anchor_node_id ?? null,
    activeGhostPathIds: pathIds,
    selectedGhostId: ghostId,
  };
}

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
      <div
        className="overflow-y-auto px-5"
        style={{ paddingBottom: "max(32px, calc(env(safe-area-inset-bottom) + 24px))" }}
      >
        {children}
      </div>
    </div>
  );
}

export function MindWorkspace({
  initialNodes,
  initialEdges,
  memoryTrails,
  recentEntries,
  promotedMemoryIds,
  sourceDocuments,
  nodeDocumentSources,
  userEmail,
}: MindWorkspaceProps) {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [uploadToast, setUploadToast] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState<GhostSuggestion[]>([]);
  // ghostId -> real_node_id created when that ghost was pinned. Lets a
  // child ghost (whose parent has already been pinned) connect to the
  // parent's new real node instead of the original root.
  const [pinnedGhostMap, setPinnedGhostMap] = useState<Record<string, string>>({});
  const [pinningGhostIds, setPinningGhostIds] = useState<string[]>([]);
  const pinningGhostIdRef = useRef<Set<string>>(new Set());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hideGhosts, setHideGhosts] = useState(false);
  const [activeRootNodeId, setActiveRootNodeId] = useState<string | null>(null);
  const [activeGhostPathIds, setActiveGhostPathIds] = useState<string[]>([]);
  const [selectedGhostId, setSelectedGhostId] = useState<string | null>(null);

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
    setSelectedGhostId(null);
    setActiveGhostPathIds([]);
    setActiveRootNodeId(id);
    if (id) {
      setActiveSheet("detail");
    } else {
      setActiveSheet(null);
    }
  }, []);

  const handleGhostSelect = useCallback((ghostId: string) => {
    const next = getGhostPathState(ghosts, ghostId);
    setSelectedNodeId(next.activeRootNodeId);
    setActiveSheet(null);
    setActiveRootNodeId(next.activeRootNodeId);
    setActiveGhostPathIds(next.activeGhostPathIds);
    setSelectedGhostId(next.selectedGhostId);
  }, [ghosts]);

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
      const newGhosts: GhostSuggestion[] = suggestions.map((suggestion, i) => {
        const id = `ghost-${ts}-${i}`;
        return {
          ...suggestion,
          id,
          ghost_id: id,
          anchor_type: selectedNodeId ? "real_node" : "graph",
          anchor_node_id: selectedNodeId ?? undefined,
          root_node_id: selectedNodeId ?? undefined,
          depth: 0,
          path_ids: [id],
          x: positions[i].x,
          y: positions[i].y,
        };
      });
      setGhosts(newGhosts);
      setActiveRootNodeId(selectedNodeId);
      setActiveGhostPathIds([]);
      setSelectedGhostId(null);
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
        const parentPath = parent.path_ids && parent.path_ids.length > 0
          ? parent.path_ids
          : deriveGhostPath(ghosts, parent.id);
        const children: GhostSuggestion[] = suggestions.map((suggestion, i) => {
          const id = `ghost-${ts}-${i}`;
          return {
            ...suggestion,
            id,
            ghost_id: id,
            anchor_type: "ghost_node",
            anchor_node_id: parent.id,
            parent_ghost_id: parent.id,
            root_node_id: parent.root_node_id,
            depth: (parent.depth ?? Math.max(parentPath.length - 1, 0)) + 1,
            path_ids: [...parentPath, id],
            x: positions[i].x,
            y: positions[i].y,
          };
        });
        setGhosts((prev) => [...prev, ...children]);
        setActiveRootNodeId(parent.root_node_id ?? null);
        setActiveGhostPathIds(parentPath);
        setSelectedGhostId(parent.id);
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
      if (pinnedGhostMap[ghostId] || pinningGhostIdRef.current.has(ghostId)) return;

      pinningGhostIdRef.current.add(ghostId);
      setPinningGhostIds((prev) => prev.includes(ghostId) ? prev : [...prev, ghostId]);
      setAiError(null);

      try {
        let sourceNodeId: string | undefined;
        if (ghost.anchor_type === "real_node") {
          sourceNodeId = ghost.anchor_node_id;
        } else if (ghost.anchor_type === "ghost_node") {
          // Prefer the nearest pinned ghost ancestor, so pinned chains connect
          // parent real node -> child real node. Fall back to the real root.
          const pathIds = ghost.path_ids && ghost.path_ids.length > 0
            ? ghost.path_ids
            : deriveGhostPath(ghosts, ghost.id);
          const ancestorIds = pathIds.slice(0, -1).reverse();
          const pinnedAncestorId = ancestorIds.find((id) => pinnedGhostMap[id]);
          sourceNodeId = pinnedAncestorId
            ? pinnedGhostMap[pinnedAncestorId]
            : ghost.root_node_id;
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
        const next = getGhostPathState(ghosts, ghostId);
        setActiveRootNodeId(next.activeRootNodeId);
        setActiveGhostPathIds(next.activeGhostPathIds);
        setSelectedGhostId(next.selectedGhostId);
      } catch (err) {
        setAiError(err instanceof Error ? err.message : "Could not pin to canvas.");
      } finally {
        pinningGhostIdRef.current.delete(ghostId);
        setPinningGhostIds((prev) => prev.filter((id) => id !== ghostId));
      }
    },
    [ghosts, pinnedGhostMap],
  );

  const handleClearGhosts = useCallback(() => {
    setGhosts([]);
    setActiveRootNodeId(null);
    setActiveGhostPathIds([]);
    setSelectedGhostId(null);
    setPinnedGhostMap({});
    pinningGhostIdRef.current.clear();
    setPinningGhostIds([]);
  }, []);

  const handleGhostDismiss = useCallback((ghostId: string) => {
    setGhosts((prev) => {
      const removed = new Set<string>([ghostId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const ghost of prev) {
          if (ghost.parent_ghost_id && removed.has(ghost.parent_ghost_id) && !removed.has(ghost.id)) {
            removed.add(ghost.id);
            changed = true;
          }
        }
      }
      return prev.filter((g) => !removed.has(g.id));
    });
    if (selectedGhostId === ghostId || activeGhostPathIds.includes(ghostId)) {
      setActiveGhostPathIds([]);
      setSelectedGhostId(null);
    }
  }, [activeGhostPathIds, selectedGhostId]);

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
            const newGhosts: GhostSuggestion[] = suggestions.map((suggestion, i) => {
              const id = `ghost-${ts}-${i}`;
              return {
                ...suggestion,
                id,
                ghost_id: id,
                anchor_type: "real_node",
                anchor_node_id: node.id,
                root_node_id: node.id,
                depth: 0,
                path_ids: [id],
                x: positions[i].x,
                y: positions[i].y,
              };
            });
            setGhosts((prev) => [...prev, ...newGhosts]);
            setActiveRootNodeId(node.id);
            setActiveGhostPathIds([]);
            setSelectedGhostId(null);
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
            const newGhosts: GhostSuggestion[] = suggestions.map((suggestion, i) => {
              const id = `ghost-${ts}-${i}`;
              return {
                ...suggestion,
                id,
                ghost_id: id,
                anchor_type: "real_node",
                anchor_node_id: a.id,
                root_node_id: a.id,
                depth: 0,
                path_ids: [id],
                x: positions[i].x,
                y: positions[i].y,
              };
            });
            setGhosts((prev) => [...prev, ...newGhosts]);
            setActiveRootNodeId(a.id);
            setActiveGhostPathIds([]);
            setSelectedGhostId(null);
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
  const visibleGhosts = useMemo(() => {
    if (hideGhosts) return [];
    const activeSet = new Set(activeGhostPathIds);
    const childOfSelected = new Set(
      ghosts
        .filter((ghost) => ghost.parent_ghost_id && ghost.parent_ghost_id === selectedGhostId)
        .map((ghost) => ghost.id),
    );
    return ghosts.map((ghost) => ({
      ...ghost,
      is_selected: ghost.id === selectedGhostId,
      is_active_path: activeSet.has(ghost.id),
      is_path_ancestor: activeSet.has(ghost.id) && ghost.id !== selectedGhostId,
      is_path_child: childOfSelected.has(ghost.id),
      is_dimmed: activeSet.size > 0
        && !activeSet.has(ghost.id)
        && !childOfSelected.has(ghost.id),
      is_pinned: Boolean(pinnedGhostMap[ghost.id]),
      is_pin_pending: pinningGhostIds.includes(ghost.id),
    }));
  }, [activeGhostPathIds, ghosts, hideGhosts, pinnedGhostMap, pinningGhostIds, selectedGhostId]);

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Canvas
          dbNodes={initialNodes}
          dbEdges={initialEdges}
          selectedNodeId={selectedNodeId}
          onNodeSelect={handleNodeSelect}
          ghostSuggestions={visibleGhosts}
          activeRootNodeId={activeRootNodeId}
          activeGhostPathIds={activeGhostPathIds}
          selectedGhostId={selectedGhostId}
          onGhostSelect={handleGhostSelect}
          onGhostExplore={handleGhostExplore}
          onGhostPin={handleGhostPin}
          onGhostDismiss={handleGhostDismiss}
        />
      </div>

      <header
        className={[
          "fixed left-0 right-0 top-0 z-20",
          "flex items-center justify-between px-4 py-2.5",
          "bg-canvas-bg/80 backdrop-blur-md",
          "border-b border-canvas-border/50",
        ].join(" ")}
      >
        <p className="text-sm font-semibold tracking-tight text-neutral-100">
          MindNode
        </p>
        <div className="flex items-center gap-1.5">
          {/* AI / Suggest — sparkle icon */}
          <button
            type="button"
            onClick={handleSuggestAvenues}
            disabled={aiLoading}
            aria-label={suggestLabel}
            title={suggestLabel}
            className={[
              "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
              aiLoading
                ? "border-purple-400/20 bg-purple-950/20 text-purple-400/40"
                : "border-purple-400/40 bg-purple-950/30 text-purple-300 hover:bg-purple-900/50",
            ].join(" ")}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M6.5 1L7.6 4.4H11.2L8.3 6.5L9.4 9.9L6.5 7.8L3.6 9.9L4.7 6.5L1.8 4.4H5.4Z" fill="currentColor" />
            </svg>
          </button>

          {/* Insights — only shown when there are insights */}
          {insightCount > 0 && (
            <button
              type="button"
              onClick={() => openSheet("insights")}
              aria-label={`Insights: ${insightCount}`}
              className="flex h-7 items-center gap-1 rounded-full border border-teal-400/40 bg-teal-950/30 px-2 text-[11px] font-medium text-teal-200 hover:bg-teal-950/50"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <rect x="0" y="5" width="2" height="5" rx="0.5" fill="currentColor" />
                <rect x="4" y="2" width="2" height="8" rx="0.5" fill="currentColor" />
                <rect x="8" y="0" width="2" height="10" rx="0.5" fill="currentColor" />
              </svg>
              {insightCount}
            </button>
          )}

          {/* Search */}
          <button
            type="button"
            onClick={() => openSheet("search")}
            aria-label="Search thoughts"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-canvas-border bg-canvas-surface text-neutral-400 hover:text-neutral-100"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8.5 8.5L11.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {/* Documents — folder icon with count badge */}
          <button
            type="button"
            onClick={() => openSheet("documents")}
            aria-label="Documents"
            className="relative flex h-7 w-7 items-center justify-center rounded-full border border-canvas-border bg-canvas-surface text-neutral-400 hover:text-neutral-100"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path
                d="M1 3.5a1 1 0 0 1 1-1h3l1.2 1.2H11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3.5Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            {sourceDocuments.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-600 text-[8px] font-bold leading-none text-white">
                {Math.min(sourceDocuments.length, 9)}
              </span>
            )}
          </button>

          {/* Thoughts — list icon with count badge */}
          <button
            type="button"
            onClick={() => openSheet("thoughts")}
            aria-label="Recent thoughts"
            className="relative flex h-7 w-7 items-center justify-center rounded-full border border-canvas-border bg-canvas-surface text-neutral-400 hover:text-neutral-100"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M1 3h11M1 6.5h8M1 10h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {recentEntries.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-600 text-[8px] font-bold leading-none text-white">
                {Math.min(recentEntries.length, 9)}
              </span>
            )}
          </button>

          {/* Avatar / sign out */}
          <form action={signOutAction}>
            <button
              type="submit"
              title={`Sign out (${userEmail})`}
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

      {/* Graph control tray — bottom-left glass pill, above safe area */}
      <div
        className="fixed left-4 z-20 flex items-center gap-0.5 rounded-full border border-canvas-border bg-canvas-surface/90 px-1.5 py-1.5 shadow-md backdrop-blur-sm"
        style={{ bottom: "max(24px, calc(env(safe-area-inset-bottom) + 8px))" }}
      >
        <button
          type="button"
          onClick={() => setHideGhosts((h) => !h)}
          aria-label={hideGhosts ? "Show AI suggestions" : "Hide AI suggestions"}
          title={hideGhosts ? "Show AI suggestions" : "Hide AI suggestions"}
          className={[
            "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
            hideGhosts ? "text-neutral-600 hover:text-neutral-400" : "text-neutral-400 hover:text-neutral-100",
          ].join(" ")}
        >
          {hideGhosts ? (
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path
                d="M2 2L13 13M6.2 6.3A2 2 0 0 0 8.7 8.8M4 4.4C2.6 5.4 1.5 6.6 1 7.5c1.3 2.5 3.8 4.5 6.5 4.5 1.2 0 2.3-.3 3.3-.9M9.5 3.8C8.9 3.3 8.2 3 7.5 3 4.8 3 2.3 5 1 7.5c.5.9 1.3 1.7 2.2 2.4"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M1 7.5C2.3 5 4.8 3 7.5 3S12.7 5 14 7.5C12.7 10 10.2 12 7.5 12S2.3 10 1 7.5Z" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>
        {ghosts.length > 0 && (
          <>
            <div className="h-4 w-px bg-canvas-border" />
            <button
              type="button"
              onClick={handleClearGhosts}
              aria-label="Clear all AI suggestions"
              title="Clear all AI suggestions"
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-red-400"
            >
              <svg width="10" height="10" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => openSheet("composer")}
        aria-label="Add thought"
        className={[
          "fixed right-5 z-20",
          "flex h-14 w-14 items-center justify-center",
          "rounded-full bg-neutral-100 shadow-lg shadow-black/50",
          "text-canvas-bg transition-all duration-200",
          sheetOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100",
        ].join(" ")}
        style={{ bottom: "max(24px, calc(env(safe-area-inset-bottom) + 8px))" }}
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
          nodeDocumentSources={nodeDocumentSources}
          onSelectNode={(id) => {
            setSelectedNodeId(id);
          }}
          onNodeDeleted={closeSheet}
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

      <BottomSheet
        open={activeSheet === "documents"}
        onClose={closeSheet}
        title={`Documents (${sourceDocuments.length})`}
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setActiveSheet("upload")}
            className="block w-full rounded-md border border-teal-400/40 bg-teal-950/30 px-3 py-2 text-sm font-medium text-teal-200 hover:bg-teal-950/50"
          >
            Upload document
          </button>
          <DocumentList documents={sourceDocuments} />
        </div>
      </BottomSheet>

      <BottomSheet
        open={activeSheet === "upload"}
        onClose={closeSheet}
        title="Upload document"
      >
        <DocumentUploadSheet
          onSuccess={({
            nodesCreated,
            edgesCreated,
            warningsCount,
            filename,
            sectionCount,
            chunkCount,
            status,
          }) => {
            const base =
              status === "processed_with_warnings" || warningsCount > 0
                ? `Processed ${filename} with warnings`
                : `Processed ${filename}`;
            const details = [
              `${sectionCount} section${sectionCount === 1 ? "" : "s"}`,
              `${chunkCount} chunk${chunkCount === 1 ? "" : "s"}`,
              `${nodesCreated} node${nodesCreated === 1 ? "" : "s"}`,
              `${edgesCreated} edge${edgesCreated === 1 ? "" : "s"}`,
            ].join(", ");
            const warningSuffix =
              warningsCount > 0
                ? `, ${warningsCount} warning${warningsCount === 1 ? "" : "s"}`
                : "";
            setUploadToast(`${base}: ${details}${warningSuffix}.`);
            setActiveSheet("documents");
            router.refresh();
            setTimeout(() => setUploadToast(null), 5000);
          }}
        />
      </BottomSheet>

      {uploadToast && (
        <div className="fixed bottom-24 left-1/2 z-40 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-950/80 px-4 py-2 text-xs text-emerald-200 backdrop-blur">
          <span className="line-clamp-2">{uploadToast}</span>
          <button
            type="button"
            onClick={() => setUploadToast(null)}
            aria-label="Dismiss"
            className="shrink-0 text-emerald-300 hover:text-emerald-100"
          >
            ×
          </button>
        </div>
      )}
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
