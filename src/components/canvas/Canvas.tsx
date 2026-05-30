"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type OnNodeDrag,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { updateNodePositionAction } from "@/lib/graph/actions";
import { GhostNodeComponent, type GhostNodeData } from "@/components/nodes/ghost-node";
import { categoryColour } from "@/lib/graph/insights";
import type { GraphNode, GraphEdge } from "@/types";

type MindNodeData = Record<string, unknown> & {
  label: string;
  origin: string;
  focused?: boolean;
  connected?: boolean;
  dimmed?: boolean;
  categoryStroke: string;
  categoryGlow: string;
  categoryBg: string;
};

export type GhostAnchorType = "real_node" | "ghost_node" | "graph";

export type GhostSuggestion = {
  id: string;
  ghost_id?: string;
  title: string;
  summary: string;
  category: string;
  relationship_type: string;
  reason: string;
  confidence: number;
  anchor_type: GhostAnchorType;
  anchor_node_id?: string;
  parent_ghost_id?: string;
  root_node_id?: string;
  depth?: number;
  path_ids?: string[];
  is_selected?: boolean;
  is_active_path?: boolean;
  is_path_ancestor?: boolean;
  is_path_child?: boolean;
  is_dimmed?: boolean;
  is_pinned?: boolean;
  is_pin_pending?: boolean;
  x: number;
  y: number;
};

// Small origin badge shown above the node label. Keeps the provenance of a
// node legible at a glance (document root vs section vs AI concept vs memory).
function originBadge(
  origin: string,
): { label: string; className: string } | null {
  switch (origin) {
    case "document_root":
      return { label: "Document", className: "text-blue-300/80" };
    case "document_section":
      return { label: "Section", className: "text-blue-300/60" };
    case "document_ai":
      return { label: "Concept", className: "text-blue-300/60" };
    case "ai_pinned":
      return { label: "AI", className: "text-violet-300/70" };
    case "chat_suggested":
      return { label: "Chat", className: "text-teal-300/70" };
    case "memory":
      return { label: "Memory", className: "text-neutral-400/70" };
    default:
      return null;
  }
}

function MindNodeComponent({ data, selected }: NodeProps<Node<MindNodeData>>) {
  const focused = data.focused || selected;
  const connected = data.connected;
  const dimmed = data.dimmed;
  const isDocRoot = data.origin === "document_root";
  const badge = originBadge(data.origin);

  // Focused/selected state dominates — overrides to white-ish border + scale.
  // Connected state uses category accent ring.
  // Default uses category stroke at low opacity.
  const borderStyle = focused
    ? undefined
    : { borderColor: connected ? data.categoryStroke : `${data.categoryStroke}44` };
  const bgStyle = focused
    ? undefined
    : { backgroundColor: data.categoryBg };
  const boxShadow = focused
    ? undefined
    : connected
    ? `0 0 10px ${data.categoryGlow}, 0 2px 8px rgba(0,0,0,0.4)`
    : `0 0 6px ${data.categoryGlow}, 0 1px 4px rgba(0,0,0,0.3)`;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 6, height: 6, border: "none" }}
      />
      <div
        className={[
          // Document roots are visually larger so a collapsed document reads
          // as a clear source anchor rather than just another concept.
          isDocRoot ? "w-52 px-4 py-3.5" : "w-40 px-3 py-2.5",
          "rounded-2xl border text-center transition-all duration-200",
          focused
            ? "border-teal-300 bg-neutral-800 shadow-xl shadow-teal-500/25 scale-[1.1]"
            : isDocRoot
            ? "border-blue-400/50 shadow-md"
            : connected
            ? "shadow-md"
            : "shadow-sm",
          dimmed ? "opacity-20" : "opacity-100",
        ].join(" ")}
        style={focused ? undefined : { ...borderStyle, ...bgStyle, boxShadow }}
      >
        {badge && (
          <p
            className={[
              "mb-0.5 text-[9px] font-semibold uppercase tracking-wider",
              badge.className,
            ].join(" ")}
          >
            {badge.label}
          </p>
        )}
        <p
          className={[
            "line-clamp-2 font-medium leading-snug",
            isDocRoot ? "text-sm" : "text-xs",
            focused ? "text-white" : "text-neutral-100",
          ].join(" ")}
        >
          {data.label}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 6, height: 6, border: "none" }}
      />
    </>
  );
}

const nodeTypes = { mindNode: MindNodeComponent, ghostNode: GhostNodeComponent };

// Animates the viewport to centre on the selected real node.
function FocusController({
  selectedNodeId,
  dbNodes,
}: {
  selectedNodeId: string | null;
  dbNodes: GraphNode[];
}) {
  const { setCenter, getZoom } = useReactFlow();
  useEffect(() => {
    if (!selectedNodeId) return;
    const n = dbNodes.find((d) => d.id === selectedNodeId);
    if (!n) return;
    const z = Math.max(getZoom(), 1.0);
    setCenter(n.position_x + 80, n.position_y + 25, { zoom: z, duration: 550 });
  }, [selectedNodeId, dbNodes, setCenter, getZoom]);
  return null;
}

function GhostPathFocusController({
  activeRootNodeId,
  activeGhostPathIds,
  selectedGhostId,
  dbNodes,
  ghostSuggestions,
}: {
  activeRootNodeId: string | null;
  activeGhostPathIds: string[];
  selectedGhostId: string | null;
  dbNodes: GraphNode[];
  ghostSuggestions: GhostSuggestion[];
}) {
  const { fitBounds } = useReactFlow();

  useEffect(() => {
    if (activeGhostPathIds.length === 0 && !selectedGhostId) return;

    const points: { x: number; y: number }[] = [];
    const root = activeRootNodeId
      ? dbNodes.find((node) => node.id === activeRootNodeId)
      : undefined;
    if (root) {
      points.push({ x: root.position_x, y: root.position_y });
      points.push({ x: root.position_x + 160, y: root.position_y + 80 });
    }

    const activeSet = new Set(activeGhostPathIds);
    for (const ghost of ghostSuggestions) {
      const inPath = activeSet.has(ghost.id);
      const isImmediateChild = Boolean(
        selectedGhostId && ghost.parent_ghost_id === selectedGhostId,
      );
      if (!inPath && !isImmediateChild) continue;
      points.push({ x: ghost.x, y: ghost.y });
      points.push({ x: ghost.x + 176, y: ghost.y + 110 });
    }

    if (points.length === 0) return;

    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const padding = 96;

    fitBounds(
      {
        x: minX - padding,
        y: minY - padding,
        width: Math.max(maxX - minX + padding * 2, 320),
        height: Math.max(maxY - minY + padding * 2, 260),
      },
      { duration: 650, padding: 0.18 },
    );
  }, [activeGhostPathIds, activeRootNodeId, dbNodes, fitBounds, ghostSuggestions, selectedGhostId]);

  return null;
}

function toFlowNodes(dbNodes: GraphNode[]): Node<MindNodeData>[] {
  return dbNodes.map((n) => {
    const colours = categoryColour(n.category || "general");
    return {
      id: n.id,
      type: "mindNode",
      position: { x: n.position_x, y: n.position_y },
      data: {
        label: n.title,
        origin: n.origin,
        categoryStroke: colours.stroke,
        categoryGlow: colours.glow,
        categoryBg: colours.bg,
      },
    };
  });
}

type CanvasProps = {
  dbNodes: GraphNode[];
  dbEdges: GraphEdge[];
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  ghostSuggestions: GhostSuggestion[];
  activeRootNodeId: string | null;
  activeGhostPathIds: string[];
  selectedGhostId: string | null;
  onGhostSelect: (id: string) => void;
  onGhostExplore: (id: string) => void;
  onGhostPin: (id: string) => void;
  onGhostDismiss: (id: string) => void;
};

export function Canvas({
  dbNodes,
  dbEdges,
  selectedNodeId,
  onNodeSelect,
  ghostSuggestions,
  activeRootNodeId,
  activeGhostPathIds,
  selectedGhostId,
  onGhostSelect,
  onGhostExplore,
  onGhostPin,
  onGhostDismiss,
}: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<
    Node<MindNodeData> | Node<GhostNodeData>
  >(toFlowNodes(dbNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const connectedIds = useMemo<Set<string>>(() => {
    if (!selectedNodeId) return new Set();
    const s = new Set<string>();
    for (const e of dbEdges) {
      if (e.source_node_id === selectedNodeId) s.add(e.target_node_id);
      if (e.target_node_id === selectedNodeId) s.add(e.source_node_id);
    }
    return s;
  }, [dbEdges, selectedNodeId]);

  // Build a quick lookup for source node category colour.
  const nodeColourMap = useMemo<Map<string, { stroke: string; glow: string; bg: string }>>(() => {
    const m = new Map<string, { stroke: string; glow: string; bg: string }>();
    for (const n of dbNodes) {
      m.set(n.id, categoryColour(n.category || "general"));
    }
    return m;
  }, [dbNodes]);

  const styledEdges = useMemo<Edge[]>(() => {
    // When the canvas is dense, only the selected node's neighbourhood gets
    // labels — otherwise overlapping relationship text drowns the graph.
    const showAllLabels = dbEdges.length <= 40;
    return dbEdges.map((e) => {
      const touchesSelected =
        selectedNodeId !== null &&
        (e.source_node_id === selectedNodeId || e.target_node_id === selectedNodeId);
      const dimmed = selectedNodeId !== null && !touchesSelected;
      // Strength-based width, capped at 3.
      const width = Math.min(1 + (typeof e.strength === "number" ? e.strength : 1), 3);
      // Category tint from source node at low opacity when not focused.
      const sourceCat = nodeColourMap.get(e.source_node_id);
      const categoryStroke = sourceCat ? sourceCat.stroke : "#3a3f4b";
      const showLabel = touchesSelected || showAllLabels;
      // Fade unselected edges so the selected neighbourhood stands out, and
      // keep background edges faint when nothing is selected on a busy canvas.
      const baseOpacity =
        selectedNodeId !== null
          ? dimmed
            ? 0.18
            : 1
          : showAllLabels
          ? 1
          : 0.55;
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: showLabel ? e.label ?? e.relationship_type : undefined,
        type: "default",
        animated: touchesSelected,
        style: {
          stroke: touchesSelected ? "#5eead4" : `${categoryStroke}55`,
          strokeWidth: touchesSelected ? Math.max(width, 2) : width,
          opacity: baseOpacity,
        },
        labelStyle: {
          fill: touchesSelected ? "#5eead4" : "#6b7280",
          fontSize: 11,
          opacity: dimmed ? 0.4 : 1,
        },
        labelBgStyle: { fill: "#0f1115" },
      };
    });
  }, [dbEdges, selectedNodeId, nodeColourMap]);

  const ghostFlowNodes = useMemo<Node<GhostNodeData>[]>(() => {
    return ghostSuggestions.map((g) => ({
      id: g.id,
      type: "ghostNode",
      position: { x: g.x, y: g.y },
      draggable: false,
      data: {
        title: g.title,
        category: g.category,
        reason: g.reason,
        confidence: g.confidence,
        isSelectedGhost: g.is_selected,
        isActivePath: g.is_active_path,
        isPathAncestor: g.is_path_ancestor,
        isPathChild: g.is_path_child,
        isDimmed: g.is_dimmed,
        isPinned: g.is_pinned,
        isPinning: g.is_pin_pending,
        depth: g.depth,
        onExplore: () => onGhostExplore(g.id),
        onPin: () => onGhostPin(g.id),
        onDismiss: () => onGhostDismiss(g.id),
      },
    }));
  }, [ghostSuggestions, onGhostExplore, onGhostPin, onGhostDismiss]);

  const ghostStyledEdges = useMemo<Edge[]>(() => {
    const realNodeIds = new Set(dbNodes.map((n) => n.id));
    const ghostIds = new Set(ghostSuggestions.map((g) => g.id));
    const activeSet = new Set(activeGhostPathIds);
    const out: Edge[] = [];
    for (const g of ghostSuggestions) {
      let source: string | undefined;
      if (g.anchor_type === "real_node" && g.anchor_node_id) {
        if (realNodeIds.has(g.anchor_node_id)) source = g.anchor_node_id;
      } else if (g.anchor_type === "ghost_node" && g.parent_ghost_id) {
        if (ghostIds.has(g.parent_ghost_id)) source = g.parent_ghost_id;
      }
      if (!source) continue;
      const activeChain = activeSet.has(g.id) && (g.anchor_type === "real_node" || activeSet.has(source));
      out.push({
        id: `ghost-edge-${g.id}`,
        source,
        target: g.id,
        type: "default",
        animated: false,
        style: {
          stroke: "#a78bfa",
          strokeWidth: activeChain ? 2.25 : 1,
          strokeDasharray: "5 3",
          opacity: activeChain ? 0.95 : g.is_dimmed ? 0.25 : 0.65,
          filter: activeChain
            ? "drop-shadow(0 0 6px rgba(196,181,253,0.75))"
            : "drop-shadow(0 0 3px rgba(167,139,250,0.4))",
        },
      });
    }
    return out;
  }, [activeGhostPathIds, ghostSuggestions, dbNodes]);

  const allEdges = useMemo<Edge[]>(
    () => [...styledEdges, ...ghostStyledEdges],
    [styledEdges, ghostStyledEdges],
  );

  useEffect(() => {
    setEdges(allEdges);
  }, [allEdges, setEdges]);

  // Reconcile the canvas nodes against the (already view-filtered) dbNodes:
  // add newcomers, drop nodes that are no longer visible, and preserve the
  // live position of nodes the user has dragged this session. Focus/connected/
  // dimmed flags and ghost nodes are applied in the same pass so visibility,
  // selection styling, and ghosts never race each other.
  useEffect(() => {
    setNodes((prev) => {
      const prevPos = new Map(
        prev
          .filter((n) => n.type !== "ghostNode")
          .map((n) => [n.id, n.position]),
      );
      const realNodes = toFlowNodes(dbNodes).map((n) => {
        const position = prevPos.get(n.id) ?? n.position;
        const focused = n.id === selectedNodeId;
        const connected = connectedIds.has(n.id);
        const dimmed = selectedNodeId !== null && !focused && !connected;
        return { ...n, position, data: { ...n.data, focused, connected, dimmed } };
      });
      return [...realNodes, ...ghostFlowNodes];
    });
  }, [dbNodes, ghostFlowNodes, selectedNodeId, connectedIds, setNodes]);

  const onNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    if (node.type === "ghostNode") return;
    updateNodePositionAction(node.id, node.position.x, node.position.y).catch(console.error);
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "ghostNode") {
        onGhostSelect(node.id);
        return;
      }
      onNodeSelect(node.id);
    },
    [onGhostSelect, onNodeSelect],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  if (dbNodes.length === 0 && ghostSuggestions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-xs text-center">
          <p className="text-base font-semibold text-neutral-200">
            Capture your first thought.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
            MindNode will map it on the canvas and branch related avenues
            around it as your graph grows.
          </p>
          {/* Arrow pointing to FAB at bottom-right */}
          <div className="mt-6 flex justify-end pr-2">
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              className="text-neutral-600"
              aria-hidden="true"
            >
              <path
                d="M8 8 C 16 8, 40 8, 40 36"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M34 30 L40 36 L46 30"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.2}
      maxZoom={2.5}
      nodesConnectable={false}
      connectOnClick={false}
      className="bg-canvas-bg"
    >
      <FocusController selectedNodeId={selectedNodeId} dbNodes={dbNodes} />
      <GhostPathFocusController
        activeRootNodeId={activeRootNodeId}
        activeGhostPathIds={activeGhostPathIds}
        selectedGhostId={selectedGhostId}
        dbNodes={dbNodes}
        ghostSuggestions={ghostSuggestions}
      />
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="#262a33"
      />
      <Controls
        position="top-right"
        style={{
          background: "#15181f",
          border: "1px solid #262a33",
          borderRadius: 6,
        }}
        showInteractive={false}
      />
    </ReactFlow>
  );
}
