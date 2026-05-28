"use client";

import { useState, useCallback, useMemo, useTransition } from "react";

import { Canvas } from "@/components/canvas/Canvas";
import { NodeDetail } from "@/components/nodes/node-detail";
import { ThoughtInputForm } from "@/components/input/thought-input-form";
import { RecentThoughtsList } from "@/components/input/recent-thoughts-list";
import { signOutAction } from "@/app/login/actions";
import { pinGhostSuggestionAction } from "@/lib/graph/actions";
import type { GraphNode, GraphEdge, GhostSuggestionNode } from "@/types";
import type { MemoryTrailMap } from "@/lib/graph/queries";
import type { RecentMemoryEntry } from "@/lib/memory/queries";
import type { ExplorationSuggestion } from "@/lib/ai/schema";

type MindWorkspaceProps = {
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  memoryTrails: MemoryTrailMap;
  recentEntries: RecentMemoryEntry[];
  promotedMemoryIds: string[];
  userEmail: string;
};

type ActiveSheet = "composer" | "thoughts" | "detail" | "ghost" | null;

type ExploreResponse = {
  suggestions?: ExplorationSuggestion[];
  error?: string;
};

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
      {/* drag handle */}
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

function ghostPosition(index: number, selectedNode?: GraphNode): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / 4;
  const radius = selectedNode ? 210 : 140;
  const originX = selectedNode?.position_x ?? 0;
  const originY = selectedNode?.position_y ?? 0;

  return {
    x: originX + Math.cos(angle) * radius,
    y: originY + Math.sin(angle) * radius,
  };
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
  const [selectedGhostId, setSelectedGhostId] = useState<string | null>(null);
  const [ghostNodes, setGhostNodes] = useState<GhostSuggestionNode[]>([]);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [isExploring, startExploreTransition] = useTransition();
  const [isPinning, startPinTransition] = useTransition();

  const selectedNode = useMemo(
    () => initialNodes.find((node) => node.id === selectedNodeId),
    [initialNodes, selectedNodeId],
  );
  const selectedGhost = useMemo(
    () => ghostNodes.find((ghost) => ghost.id === selectedGhostId),
    [ghostNodes, selectedGhostId],
  );

  const openSheet = useCallback((sheet: ActiveSheet) => {
    setActiveSheet(sheet);
    if (sheet !== "detail") {
      setSelectedNodeId(null);
    }
    if (sheet !== "ghost") {
      setSelectedGhostId(null);
    }
  }, []);

  const closeSheet = useCallback(() => {
    setActiveSheet(null);
    setSelectedNodeId(null);
    setSelectedGhostId(null);
  }, []);

  const handleNodeSelect = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    setSelectedGhostId(null);
    if (id) {
      setActiveSheet("detail");
    } else {
      setActiveSheet(null);
    }
  }, []);

  const handleGhostSelect = useCallback((id: string) => {
    setSelectedGhostId(id);
    setSelectedNodeId(null);
    setActiveSheet("ghost");
    setPinError(null);
  }, []);

  const applySuggestions = useCallback(
    (suggestions: ExplorationSuggestion[], sourceNodeId?: string) => {
      const sourceNode = initialNodes.find((node) => node.id === sourceNodeId);
      const timestamp = Date.now();
      setGhostNodes(
        suggestions.map((suggestion, index) => ({
          ...suggestion,
          id: `ghost-${timestamp}-${suggestion.id}-${index}`,
          source_node_id: sourceNodeId,
          position: ghostPosition(index, sourceNode),
        })),
      );
      setSelectedGhostId(null);
    },
    [initialNodes],
  );

  const requestExploration = useCallback(
    (context?: { title: string; summary: string; category?: string }) => {
      const sourceNodeId = context ? selectedGhost?.source_node_id : selectedNodeId ?? undefined;
      setExploreError(null);
      startExploreTransition(async () => {
        const response = await fetch("/api/explore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selected_node_id: sourceNodeId,
            exploration_context: context,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as ExploreResponse;

        if (!response.ok || !payload.suggestions) {
          setExploreError(payload.error ?? "Could not explore right now.");
          return;
        }

        applySuggestions(payload.suggestions, sourceNodeId);
        setActiveSheet(null);
      });
    },
    [applySuggestions, selectedGhost?.source_node_id, selectedNodeId],
  );

  const handlePinGhost = useCallback(() => {
    if (!selectedGhost) return;
    setPinError(null);
    startPinTransition(async () => {
      const result = await pinGhostSuggestionAction({
        title: selectedGhost.title,
        summary: selectedGhost.summary,
        category: selectedGhost.category,
        source_node_id: selectedGhost.source_node_id,
        relationship_type: selectedGhost.relationship_type,
      });

      if (!result.success) {
        setPinError(result.error ?? "Could not pin suggestion.");
        return;
      }

      setGhostNodes((prev) => prev.filter((ghost) => ghost.id !== selectedGhost.id));
      setSelectedGhostId(null);
      setActiveSheet(null);
    });
  }, [selectedGhost]);

  const handleDismissGhost = useCallback(() => {
    if (!selectedGhostId) return;
    setGhostNodes((prev) => prev.filter((ghost) => ghost.id !== selectedGhostId));
    setSelectedGhostId(null);
    setActiveSheet(null);
  }, [selectedGhostId]);

  const sheetOpen = activeSheet !== null;

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Canvas — full screen */}
      <div className="absolute inset-0 z-0">
        <Canvas
          dbNodes={initialNodes}
          dbEdges={initialEdges}
          ghostNodes={ghostNodes}
          selectedNodeId={selectedNodeId}
          selectedGhostId={selectedGhostId}
          onNodeSelect={handleNodeSelect}
          onGhostSelect={handleGhostSelect}
        />
      </div>

      {/* Floating header */}
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

      {/* Explore control */}
      <div className="fixed bottom-24 left-4 z-50 max-w-[calc(100%-6rem)]">
        <button
          type="button"
          onClick={() => requestExploration()}
          disabled={isExploring}
          className="rounded-full border border-violet-300/40 bg-violet-950/70 px-4 py-2 text-xs font-semibold text-violet-100 shadow-lg shadow-black/40 backdrop-blur hover:border-violet-200 disabled:opacity-60"
        >
          {isExploring
            ? "Exploring…"
            : selectedNodeId
            ? "Explore this thought"
            : "Suggest avenues"}
        </button>
        {exploreError && (
          <p className="mt-2 max-w-60 rounded-lg border border-red-400/30 bg-red-950/60 px-3 py-2 text-xs leading-relaxed text-red-100">
            {exploreError}
          </p>
        )}
      </div>

      {/* FAB */}
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

      {/* Backdrop */}
      <div
        onClick={closeSheet}
        className={[
          "fixed inset-0 z-30 bg-black/50",
          "transition-opacity duration-300",
          sheetOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
      />

      {/* Composer sheet */}
      <BottomSheet
        open={activeSheet === "composer"}
        onClose={closeSheet}
        title="New thought"
      >
        <ThoughtInputForm onSuccess={closeSheet} />
      </BottomSheet>

      {/* Thoughts sheet */}
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

      {/* Node detail sheet */}
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

      {/* Ghost suggestion sheet */}
      <BottomSheet
        open={activeSheet === "ghost"}
        onClose={closeSheet}
        title="AI avenue"
      >
        {selectedGhost ? (
          <div className="space-y-4">
            <div>
              <p className="text-base font-semibold leading-snug text-neutral-100">
                {selectedGhost.title}
              </p>
              <p className="mt-1 text-xs text-violet-200/80">
                {selectedGhost.category} · {Math.round(selectedGhost.confidence * 100)}% confidence
              </p>
            </div>
            <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
              <p className="text-sm leading-relaxed text-neutral-200">
                {selectedGhost.summary}
              </p>
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">
              {selectedGhost.reason}
            </p>
            {pinError && <p className="text-xs text-red-400">{pinError}</p>}
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() =>
                  requestExploration({
                    title: selectedGhost.title,
                    summary: selectedGhost.summary,
                    category: selectedGhost.category,
                  })
                }
                disabled={isExploring}
                className="rounded-lg border border-violet-300/40 bg-violet-950/40 px-3 py-2 text-sm font-medium text-violet-100 disabled:opacity-60"
              >
                {isExploring ? "Exploring…" : "Explore deeper"}
              </button>
              <button
                type="button"
                onClick={handlePinGhost}
                disabled={isPinning}
                className="rounded-lg bg-teal-300 px-3 py-2 text-sm font-semibold text-canvas-bg disabled:opacity-60"
              >
                {isPinning ? "Pinning…" : "Pin to canvas"}
              </button>
              <button
                type="button"
                onClick={handleDismissGhost}
                className="rounded-lg border border-canvas-border px-3 py-2 text-sm text-neutral-400"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-600">Suggestion not found.</p>
        )}
      </BottomSheet>
    </div>
  );
}
