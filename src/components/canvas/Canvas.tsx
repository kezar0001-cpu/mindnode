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
import type { GraphNode, GraphEdge, GhostSuggestionNode } from "@/types";

type MindNodeData = Record<string, unknown> & {
  label: string;
  focused?: boolean;
  connected?: boolean;
  dimmed?: boolean;
  ghost?: boolean;
  category?: string;
};

function MindNodeComponent({ data, selected }: NodeProps<Node<MindNodeData>>) {
  const focused = data.focused || selected;
  const connected = data.connected;
  const dimmed = data.dimmed;
  const ghost = data.ghost;

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
          ghost
            ? "border-dashed border-violet-300/70 bg-violet-950/30 shadow-lg shadow-violet-500/20"
            : focused
            ? "border-teal-300 bg-neutral-800 shadow-lg shadow-teal-500/20 scale-105"
            : connected
            ? "border-teal-300/40 bg-canvas-surface shadow-md shadow-teal-500/10"
            : "border-canvas-border bg-canvas-surface shadow-sm",
          dimmed && !ghost ? "opacity-50" : "opacity-100",
        ].join(" ")}
      >
        {ghost && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-200">
            AI avenue
          </p>
        )}
        <p
          className={[
            "line-clamp-2 text-xs font-medium leading-snug",
            focused || ghost ? "text-white" : "text-neutral-100",
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

const nodeTypes = { mindNode: MindNodeComponent };

function toFlowNodes(dbNodes: GraphNode[]): Node<MindNodeData>[] {
  return dbNodes.map((n) => ({
    id: n.id,
    type: "mindNode",
    position: { x: n.position_x, y: n.position_y },
    data: { label: n.title, category: n.category },
  }));
}

function toGhostFlowNodes(ghostNodes: GhostSuggestionNode[]): Node<MindNodeData>[] {
  return ghostNodes.map((ghost) => ({
    id: ghost.id,
    type: "mindNode",
    position: ghost.position,
    data: { label: ghost.title, category: ghost.category, ghost: true },
  }));
}

type CanvasProps = {
  dbNodes: GraphNode[];
  dbEdges: GraphEdge[];
  ghostNodes: GhostSuggestionNode[];
  selectedNodeId: string | null;
  selectedGhostId: string | null;
  onNodeSelect: (id: string | null) => void;
  onGhostSelect: (id: string) => void;
};

export function Canvas({
  dbNodes,
  dbEdges,
  ghostNodes,
  selectedNodeId,
  selectedGhostId,
  onNodeSelect,
  onGhostSelect,
}: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MindNodeData>>([
    ...toFlowNodes(dbNodes),
    ...toGhostFlowNodes(ghostNodes),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const ghostIds = useMemo(() => new Set(ghostNodes.map((ghost) => ghost.id)), [ghostNodes]);

  // Compute connected IDs based on current selection.
  const connectedIds = useMemo<Set<string>>(() => {
    if (!selectedNodeId) return new Set();
    const s = new Set<string>();
    for (const e of dbEdges) {
      if (e.source_node_id === selectedNodeId) s.add(e.target_node_id);
      if (e.target_node_id === selectedNodeId) s.add(e.source_node_id);
    }
    return s;
  }, [dbEdges, selectedNodeId]);

  // Styled edges depend on selection. Re-derive when either changes.
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
        type: "smoothstep",
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

  useEffect(() => {
    setEdges(styledEdges);
  }, [styledEdges, setEdges]);

  // Reconcile real and ghost nodes while preserving any local drag positions.
  useEffect(() => {
    const incoming = [...toFlowNodes(dbNodes), ...toGhostFlowNodes(ghostNodes)];
    const incomingIds = new Set(incoming.map((node) => node.id));

    setNodes((prev) => {
      const previousById = new Map(prev.map((node) => [node.id, node]));
      return incoming.map((node) => {
        const previous = previousById.get(node.id);
        return {
          ...node,
          position: previous?.position ?? node.position,
          selected: previous?.selected,
        };
      }).filter((node) => incomingIds.has(node.id));
    });
  }, [dbNodes, ghostNodes, setNodes]);

  // Re-apply focus/connected/dimmed flags whenever selection or edges change.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const isGhost = ghostIds.has(n.id);
        const focused = n.id === selectedNodeId || n.id === selectedGhostId;
        const connected = !isGhost && connectedIds.has(n.id);
        const dimmed = selectedNodeId !== null && !focused && !connected && !isGhost;
        return {
          ...n,
          data: { ...n.data, focused, connected, dimmed, ghost: isGhost },
        };
      }),
    );
  }, [selectedNodeId, selectedGhostId, connectedIds, ghostIds, setNodes]);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      if (ghostIds.has(node.id)) return;
      updateNodePositionAction(node.id, node.position.x, node.position.y).catch(
        console.error,
      );
    },
    [ghostIds],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (ghostIds.has(node.id)) {
        onGhostSelect(node.id);
        return;
      }
      onNodeSelect(node.id);
    },
    [ghostIds, onGhostSelect, onNodeSelect],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  if (nodes.length === 0) {
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
