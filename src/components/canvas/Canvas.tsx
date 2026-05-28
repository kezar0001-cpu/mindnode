"use client";

import { useCallback, useEffect } from "react";
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
import type { GraphNode, GraphEdge } from "@/types";

type MindNodeData = Record<string, unknown> & {
  label: string;
  category: string;
};

function MindNodeComponent({ data, selected }: NodeProps<Node<MindNodeData>>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 6, height: 6, border: "none" }}
      />
      <div
        className={[
          "min-w-24 max-w-44 rounded border px-3 py-2",
          selected ? "border-neutral-400" : "border-canvas-border",
          "bg-canvas-surface shadow-sm",
        ].join(" ")}
      >
        <p className="truncate text-sm font-medium text-neutral-100">
          {data.label}
        </p>
        {data.category && data.category !== "general" && (
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {data.category}
          </p>
        )}
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

function toFlowEdges(dbEdges: GraphEdge[]): Edge[] {
  return dbEdges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    label: e.label ?? e.relationship_type,
    style: { stroke: "#262a33" },
    labelStyle: { fill: "#9ca3af", fontSize: 11 },
  }));
}

type CanvasProps = {
  dbNodes: GraphNode[];
  dbEdges: GraphEdge[];
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
};

export function Canvas({
  dbNodes,
  dbEdges,
  selectedNodeId,
  onNodeSelect,
}: CanvasProps) {
  // Pass computed values directly; useNodesState/useEdgesState only read
  // their argument during the initial render.
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(dbNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(dbEdges));

  // When dbNodes gains new IDs (after a node is created), add them to the
  // canvas without disturbing existing nodes' position/selection state.
  useEffect(() => {
    setNodes((prev) => {
      const prevIds = new Set(prev.map((n) => n.id));
      const incoming = toFlowNodes(dbNodes).filter((n) => !prevIds.has(n.id));
      return incoming.length === 0 ? prev : [...prev, ...incoming];
    });
  }, [dbNodes, setNodes]);

  // Mirror edge list when it changes.
  useEffect(() => {
    setEdges(toFlowEdges(dbEdges));
  }, [dbEdges, setEdges]);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      updateNodePositionAction(node.id, node.position.x, node.position.y).catch(
        console.error,
      );
    },
    [],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect],
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
      // Re-enable when edge creation UI lands.
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
