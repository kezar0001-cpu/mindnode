"use client";

// 3D neural-network canvas. Replaces the 2D React Flow canvas with an
// explorable force-directed graph (three.js under the hood via
// react-force-graph-3d). The force simulation owns layout — stored 2D
// positions (position_x/position_y) are intentionally NOT fed in, so the
// graph clusters organically in 3D space.
//
// This module touches WebGL/`window` at import time, so it must only ever
// be loaded in the browser. MindWorkspace imports it via
// next/dynamic({ ssr: false }); do not import it from a server component.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import { categoryColour } from "@/lib/graph/insights";
import type { GraphNode, GraphEdge } from "@/types";

// Force-graph node/link objects. The simulation mutates each node object in
// place, adding x/y/z (and velocity) fields — which is why we cache the
// objects by id across renders (see graphData memo) so layout is preserved.
type FGNode = {
  id: string;
  label: string;
  category: string;
  color: string;
  val: number;
  x?: number;
  y?: number;
  z?: number;
};

type FGLink = {
  source: string;
  target: string;
  label: string;
};

const SELECTED_COLOR = "#5eead4";
const BACKGROUND_COLOR = "#0f1115";

export type Graph3DProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
};

export function Graph3D({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
}: Graph3DProps) {
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Cache of force-graph node objects keyed by id. Reusing the same object
  // across renders keeps a node's simulated position; only genuinely new
  // ids get fresh objects (which enter at the centre and "pop" into their
  // cluster). Rebuilding these every render would reset the layout.
  const nodeCache = useRef<Map<string, FGNode>>(new Map());

  // Node connectivity → render hubs slightly larger.
  const degrees = useMemo<Map<string, number>>(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.source_node_id, (d.get(e.source_node_id) ?? 0) + 1);
      d.set(e.target_node_id, (d.get(e.target_node_id) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  // graphData only changes identity when the *set* of nodes/edges changes —
  // not when selection changes (selection is handled via the nodeColor
  // accessor). This keeps the simulation stable across selection.
  const graphData = useMemo<{ nodes: FGNode[]; links: FGLink[] }>(() => {
    const cache = nodeCache.current;
    const seen = new Set<string>();
    const fgNodes = nodes.map((n) => {
      seen.add(n.id);
      const color = categoryColour(n.category || "general").stroke;
      const val = 1 + (degrees.get(n.id) ?? 0) * 0.5;
      const existing = cache.get(n.id);
      if (existing) {
        // Update mutable display fields in place; keep simulated position.
        existing.label = n.title;
        existing.category = n.category;
        existing.color = color;
        existing.val = val;
        return existing;
      }
      const created: FGNode = {
        id: n.id,
        label: n.title,
        category: n.category,
        color,
        val,
      };
      cache.set(n.id, created);
      return created;
    });
    // Drop cached objects for nodes that no longer exist.
    for (const id of cache.keys()) {
      if (!seen.has(id)) cache.delete(id);
    }
    const fgLinks: FGLink[] = edges.map((e) => ({
      source: e.source_node_id,
      target: e.target_node_id,
      label: e.label ?? e.relationship_type,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return { nodes: fgNodes, links: fgLinks };
    // graphData identity is keyed by the node/edge id sets (+ degree).
  }, [nodes, edges, degrees]);

  // Measure the container so the canvas fills it responsively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fly the camera to the selected node.
  useEffect(() => {
    if (!selectedNodeId) return;
    const fg = fgRef.current;
    const node = nodeCache.current.get(selectedNodeId);
    if (!fg || !node || node.x === undefined) return;
    const distance = 140;
    const hypot = Math.hypot(node.x, node.y ?? 0, node.z ?? 0) || 1;
    const ratio = 1 + distance / hypot;
    fg.cameraPosition(
      { x: node.x * ratio, y: (node.y ?? 0) * ratio, z: (node.z ?? 0) * ratio },
      { x: node.x, y: node.y ?? 0, z: node.z ?? 0 },
      800,
    );
  }, [selectedNodeId]);

  const nodeColor = useCallback(
    (node: FGNode) => (node.id === selectedNodeId ? SELECTED_COLOR : node.color),
    [selectedNodeId],
  );

  const nodeVal = useCallback(
    (node: FGNode) => (node.id === selectedNodeId ? node.val * 1.6 : node.val),
    [selectedNodeId],
  );

  // Always-visible calm label sprite, drawn above the default sphere.
  const nodeThreeObject = useCallback(
    (node: FGNode) => {
      const sprite = new SpriteText(node.label);
      sprite.color =
        node.id === selectedNodeId ? SELECTED_COLOR : "rgba(229,229,229,0.85)";
      sprite.textHeight = node.id === selectedNodeId ? 5 : 3.5;
      sprite.position.set(0, (node.val ?? 1) + 6, 0);
      return sprite;
    },
    [selectedNodeId],
  );

  const handleNodeClick = useCallback(
    (node: FGNode) => onNodeSelect(node.id),
    [onNodeSelect],
  );

  const handleBackgroundClick = useCallback(
    () => onNodeSelect(null),
    [onNodeSelect],
  );

  return (
    <div ref={containerRef} className="h-full w-full" style={{ touchAction: "none" }}>
      {size.width > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor={BACKGROUND_COLOR}
          showNavInfo={false}
          nodeColor={nodeColor}
          nodeVal={nodeVal}
          nodeLabel={(node: FGNode) => node.label}
          nodeOpacity={0.9}
          nodeResolution={16}
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend
          linkColor={() => "rgba(148,163,184,0.35)"}
          linkWidth={0.5}
          linkDirectionalParticles={0}
          linkLabel={(link: FGLink) => link.label}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          cooldownTicks={120}
          warmupTicks={20}
        />
      )}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-base font-medium text-neutral-300">
            Your mind is a blank canvas
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Capture your first thought to begin.
          </p>
        </div>
      )}
    </div>
  );
}
