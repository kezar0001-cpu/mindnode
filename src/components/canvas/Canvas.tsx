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
  type Node,
  type Edge,
  type NodeProps,
  type OnNodeDrag,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { updateNodePositionAction } from "@/lib/graph/actions";
import { GhostNodeComponent, type GhostNodeData } from "@/components/nodes/ghost-node";
import type { GraphNode, GraphEdge } from "@/types";

type MindNodeData = Record<string, unknown> & {
  label: string;
  focused?: boolean;
  connected?: boolean;
  dimmed?: boolean;
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
            ? "border-teal-300 bg-neutral-800 shadow-lg shadow-teal-500/20 scale-105"
            : connected
            ? "border-teal-300/40 bg-canvas-surface shadow-md shadow-teal-500/10"
            : "border-canvas-border bg-canvas-surface shadow-sm",
          dimmed ? "opacity-50" : "opacity-100",
        ].join(" ")}
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

function toFlowNodes(dbNodes: GraphNode[]): Node<MindNodeData>[] {
  return dbNodes.map((n) => ({
    id: n.id,
    type: "mindNode",
    position: { x: n.position_x, y: n.position_y },
    data: { label: n.title },
  }));
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

  const styledEdges = useMemo<Edge[]>(() => {
    return dbEdges.map((e) => {
      const touchesSelected =
        selectedNodeId !== null &&
        (e.source_node_id === selectedNodeId || e.target_node_id === selectedNodeId);
      const dimmed = selectedNodeId !== null && !touchesSelected;
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.label ?? e.relationship_type,
        type: "default",
        animated: touchesSelected,
        style: {
          stroke: touchesSelected ? "#5eead4" : "#3a3f4b",
          strokeWidth: touchesSelected ? 2 : 1,
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
  }, [dbEdges, selectedNodeId]);

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
          strokeDasharray: "4 4",
          opacity: 0.7,
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
        <p className="text-center text-sm leading-relaxed text-neutral-500">
          Drop your first thought below.
          <br />
          I&apos;ll suggest where it belongs.
        </p>
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
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="#262a33"
      />
      <Controls
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
