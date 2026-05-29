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
  x: number;
  y: number;
};

function MindNodeComponent({ data, selected }: NodeProps<Node<MindNodeData>>) {
  const focused = data.focused || selected;
  const connected = data.connected;
  const dimmed = data.dimmed;

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
          "w-40 rounded-2xl border px-3 py-2.5 text-center transition-all duration-200",
          focused
            ? "border-teal-300 bg-neutral-800 shadow-xl shadow-teal-500/25 scale-[1.1]"
            : connected
            ? "shadow-md"
            : "shadow-sm",
          dimmed ? "opacity-20" : "opacity-100",
        ].join(" ")}
        style={focused ? undefined : { ...borderStyle, ...bgStyle, boxShadow }}
      >
        <p
          className={[
            "line-clamp-2 text-xs font-medium leading-snug",
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

function toFlowNodes(dbNodes: GraphNode[]): Node<MindNodeData>[] {
  return dbNodes.map((n) => {
    const colours = categoryColour(n.category || "general");
    return {
      id: n.id,
      type: "mindNode",
      position: { x: n.position_x, y: n.position_y },
      data: {
        label: n.title,
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
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.label ?? e.relationship_type,
        type: "default",
        animated: touchesSelected,
        style: {
          stroke: touchesSelected ? "#5eead4" : `${categoryStroke}55`,
          strokeWidth: touchesSelected ? Math.max(width, 2) : width,
          opacity: dimmed ? 0.25 : 1,
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
        onExplore: () => onGhostExplore(g.id),
        onPin: () => onGhostPin(g.id),
        onDismiss: () => onGhostDismiss(g.id),
      },
    }));
  }, [ghostSuggestions, onGhostExplore, onGhostPin, onGhostDismiss]);

  const ghostStyledEdges = useMemo<Edge[]>(() => {
    const realNodeIds = new Set(dbNodes.map((n) => n.id));
    const ghostIds = new Set(ghostSuggestions.map((g) => g.id));
    const out: Edge[] = [];
    for (const g of ghostSuggestions) {
      let source: string | undefined;
      if (g.anchor_type === "real_node" && g.anchor_node_id) {
        if (realNodeIds.has(g.anchor_node_id)) source = g.anchor_node_id;
      } else if (g.anchor_type === "ghost_node" && g.parent_ghost_id) {
        if (ghostIds.has(g.parent_ghost_id)) source = g.parent_ghost_id;
      }
      if (!source) continue;
      out.push({
        id: `ghost-edge-${g.id}`,
        source,
        target: g.id,
        type: "default",
        animated: false,
        style: {
          stroke: "#a78bfa",
          strokeWidth: 1,
          strokeDasharray: "5 3",
          opacity: 0.7,
          filter: "drop-shadow(0 0 3px rgba(167,139,250,0.4))",
        },
      });
    }
    return out;
  }, [ghostSuggestions, dbNodes]);

  const allEdges = useMemo<Edge[]>(
    () => [...styledEdges, ...ghostStyledEdges],
    [styledEdges, ghostStyledEdges],
  );

  useEffect(() => {
    setEdges(allEdges);
  }, [allEdges, setEdges]);

  // Merge new real nodes; preserve existing positions and selection.
  useEffect(() => {
    setNodes((prev) => {
      const prevRealIds = new Set(
        prev.filter((n) => n.type !== "ghostNode").map((n) => n.id),
      );
      const incoming = toFlowNodes(dbNodes).filter((n) => !prevRealIds.has(n.id));
      return incoming.length === 0 ? prev : [...prev, ...incoming];
    });
  }, [dbNodes, setNodes]);

  // Sync ghost nodes — replace any existing ghosts wholesale.
  useEffect(() => {
    setNodes((prev) => {
      const realNodes = prev.filter((n) => n.type !== "ghostNode");
      return [...realNodes, ...ghostFlowNodes];
    });
  }, [ghostFlowNodes, setNodes]);

  // Focus / connected / dimmed flags on real nodes only.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n): Node<MindNodeData> | Node<GhostNodeData> => {
        if (n.type === "ghostNode") return n;
        const real = n as Node<MindNodeData>;
        const focused = real.id === selectedNodeId;
        const connected = connectedIds.has(real.id);
        const dimmed = selectedNodeId !== null && !focused && !connected;
        return { ...real, data: { ...real.data, focused, connected, dimmed } };
      }),
    );
  }, [selectedNodeId, connectedIds, setNodes]);

  const onNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    if (node.type === "ghostNode") return;
    updateNodePositionAction(node.id, node.position.x, node.position.y).catch(console.error);
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "ghostNode") return;
      onNodeSelect(node.id);
    },
    [onNodeSelect],
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
