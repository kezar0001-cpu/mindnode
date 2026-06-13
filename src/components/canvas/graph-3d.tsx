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
import { Object3D } from "three";
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
const PREVIEW_COLOR = "#7dd3fc";
const BACKGROUND_COLOR = "#0f1115";
const PREVIEW_ID = "__preview__";
// Above this many nodes, labels are shown only for the selected node, its
// neighbours, and hubs — so the scene stays calm when the graph is dense.
const LABEL_DENSITY_THRESHOLD = 40;
const HUB_LABEL_MIN_VAL = 3;
// When a node is selected, everything outside its neighbourhood recedes so
// the lit neighbours read as the walkable paths.
const DIM_NODE_COLOR = "#2c313c";
const DIM_LINK_COLOR = "rgba(148,163,184,0.08)";

// The AI's proposed placement for a just-captured thought, rendered as a
// glowing candidate node. One tap on it keeps it (onPreviewConfirm); a tap
// on empty space discards it (onPreviewDismiss). This IS the reviewable
// suggestion — nothing is written to the graph until the tap.
export type PreviewNode = {
  title: string;
  category: string;
  // Existing node ids the proposed node would link to (shown as preview edges).
  linkTargetIds: string[];
};

export type Graph3DProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  preview: PreviewNode | null;
  onPreviewConfirm: () => void;
  onPreviewDismiss: () => void;
};

function linkNodeId(end: string | { id: string }): string {
  return typeof end === "object" ? end.id : end;
}

export function Graph3D({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  preview,
  onPreviewConfirm,
  onPreviewDismiss,
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
  // Frame the whole network once, after the first layout settles.
  const didInitialFit = useRef(false);

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
    // The glowing preview node + its proposed edges, while a suggestion is open.
    if (preview) {
      const pColor = categoryColour(preview.category || "general").stroke;
      const existing = cache.get(PREVIEW_ID);
      const pNode: FGNode = existing ?? {
        id: PREVIEW_ID,
        label: preview.title,
        category: preview.category,
        color: pColor,
        val: 6,
      };
      pNode.label = preview.title;
      pNode.category = preview.category;
      pNode.color = pColor;
      pNode.val = 6;
      cache.set(PREVIEW_ID, pNode);
      seen.add(PREVIEW_ID);
      fgNodes.push(pNode);
      for (const tid of preview.linkTargetIds) {
        if (seen.has(tid)) {
          fgLinks.push({ source: PREVIEW_ID, target: tid, label: "" });
        }
      }
    }
    return { nodes: fgNodes, links: fgLinks };
    // graphData identity is keyed by the node/edge id sets (+ degree + preview).
  }, [nodes, edges, degrees, preview]);

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

  // Spread the layout into a readable structure rather than a tight ball:
  // stronger repulsion, a comfortable link distance, and a centring pull so
  // the whole network stays framed. Configured once the instance exists.
  useEffect(() => {
    if (size.width === 0) return;
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as
      | { strength: (s: number) => unknown; distanceMax: (d: number) => unknown }
      | undefined;
    charge?.strength(-220);
    charge?.distanceMax(600);
    const link = fg.d3Force("link") as
      | { distance: (d: number) => unknown }
      | undefined;
    link?.distance(70);
    fg.d3ReheatSimulation();
  }, [size.width, nodes.length]);
  const neighborIds = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    if (!selectedNodeId) return s;
    for (const e of edges) {
      if (e.source_node_id === selectedNodeId) s.add(e.target_node_id);
      if (e.target_node_id === selectedNodeId) s.add(e.source_node_id);
    }
    return s;
  }, [edges, selectedNodeId]);

  const dense = nodes.length > LABEL_DENSITY_THRESHOLD;

  // Ease the camera toward the selected node — staying wide enough to keep
  // its neighbours (the walkable paths) in view, rather than slamming onto a
  // single point. Deselecting leaves the camera exactly where it is.
  useEffect(() => {
    if (!selectedNodeId) return;
    const fg = fgRef.current;
    const node = nodeCache.current.get(selectedNodeId);
    if (!fg || !node || node.x === undefined) return;
    // Look at the node, but keep a comfortable standoff so context stays.
    const cam = fg.camera().position;
    const dx = cam.x - node.x;
    const dy = cam.y - (node.y ?? 0);
    const dz = cam.z - (node.z ?? 0);
    const curDist = Math.hypot(dx, dy, dz) || 1;
    const targetDist = 220;
    const ratio = targetDist / curDist;
    fg.cameraPosition(
      {
        x: node.x + dx * ratio,
        y: (node.y ?? 0) + dy * ratio,
        z: (node.z ?? 0) + dz * ratio,
      },
      { x: node.x, y: node.y ?? 0, z: node.z ?? 0 },
      900,
    );
  }, [selectedNodeId]);

  const nodeColor = useCallback(
    (node: FGNode) => {
      if (node.id === PREVIEW_ID) return PREVIEW_COLOR;
      if (!selectedNodeId) return node.color;
      if (node.id === selectedNodeId) return SELECTED_COLOR;
      // Neighbours stay lit (the walkable paths); the rest recedes.
      return neighborIds.has(node.id) ? node.color : DIM_NODE_COLOR;
    },
    [selectedNodeId, neighborIds],
  );

  const nodeVal = useCallback(
    (node: FGNode) => {
      if (node.id === PREVIEW_ID) return node.val;
      return node.id === selectedNodeId ? node.val * 1.6 : node.val;
    },
    [selectedNodeId],
  );

  // Calm label sprite drawn above the default sphere. On dense graphs only
  // the focused neighbourhood and hubs get labels, so the scene stays legible.
  const nodeThreeObject = useCallback(
    (node: FGNode): Object3D => {
      // Clear the sphere: three-force-graph sizes a node sphere with radius
      // ≈ nodeRelSize * cbrt(val), so offset the label above that.
      const radius = 5 * Math.cbrt(Math.max(node.val ?? 1, 1));
      if (node.id === PREVIEW_ID) {
        const sprite = new SpriteText(`✦ ${node.label}`);
        sprite.color = PREVIEW_COLOR;
        sprite.textHeight = 4.5;
        sprite.position.set(0, radius + 6, 0);
        return sprite;
      }
      const isSelected = node.id === selectedNodeId;
      // With a selection, only the focused neighbourhood is labelled — the
      // lit, labelled neighbours are the paths you can walk next. Without
      // one, dense graphs label hubs only. Empty object = sphere without a
      // label under nodeThreeObjectExtend.
      if (selectedNodeId) {
        if (!isSelected && !neighborIds.has(node.id)) return new Object3D();
      } else if (dense && (node.val ?? 1) < HUB_LABEL_MIN_VAL) {
        return new Object3D();
      }
      const sprite = new SpriteText(node.label);
      sprite.color = isSelected ? SELECTED_COLOR : "rgba(229,229,229,0.82)";
      sprite.textHeight = isSelected ? 4.5 : 3;
      sprite.position.set(0, radius + (isSelected ? 6 : 5), 0);
      return sprite;
    },
    [selectedNodeId, dense, neighborIds],
  );

  const linkColor = useCallback(
    (link: { source: string | { id: string }; target: string | { id: string } }) => {
      const s = linkNodeId(link.source);
      const t = linkNodeId(link.target);
      if (s === PREVIEW_ID || t === PREVIEW_ID) return "rgba(125,211,252,0.7)";
      if (!selectedNodeId) return "rgba(148,163,184,0.35)";
      if (s === selectedNodeId || t === selectedNodeId) {
        return "rgba(94,234,212,0.55)";
      }
      return DIM_LINK_COLOR;
    },
    [selectedNodeId],
  );

  const linkWidth = useCallback(
    (link: { source: string | { id: string }; target: string | { id: string } }) =>
      linkNodeId(link.source) === PREVIEW_ID ||
      linkNodeId(link.target) === PREVIEW_ID
        ? 1.4
        : 0.5,
    [],
  );

  // Subtle travelling particles: along the proposed preview edges, and along
  // the selected node's links — a gentle neural pulse on what's in focus.
  const linkParticles = useCallback(
    (link: { source: string | { id: string }; target: string | { id: string } }) => {
      const s = linkNodeId(link.source);
      const t = linkNodeId(link.target);
      if (s === PREVIEW_ID || t === PREVIEW_ID) return 3;
      if (selectedNodeId && (s === selectedNodeId || t === selectedNodeId)) return 2;
      return 0;
    },
    [selectedNodeId],
  );

  const linkParticleColor = useCallback(
    (link: { source: string | { id: string }; target: string | { id: string } }) =>
      linkNodeId(link.source) === PREVIEW_ID ||
      linkNodeId(link.target) === PREVIEW_ID
        ? PREVIEW_COLOR
        : SELECTED_COLOR,
    [],
  );

  const handleNodeClick = useCallback(
    (node: FGNode) => {
      if (node.id === PREVIEW_ID) {
        onPreviewConfirm();
        return;
      }
      onNodeSelect(node.id);
    },
    [onNodeSelect, onPreviewConfirm],
  );

  const handleBackgroundClick = useCallback(() => {
    // Tapping empty space only discards an open capture preview. It must NOT
    // clear the selection — an accidental off-node tap should never reset the
    // user's idea flow. Deliberate reset lives on the Overview button.
    if (preview) onPreviewDismiss();
  }, [preview, onPreviewDismiss]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{ touchAction: "none" }}
    >
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
          nodeRelSize={5}
          nodeLabel={(node: FGNode) => node.label}
          nodeOpacity={0.92}
          nodeResolution={16}
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkDirectionalParticles={linkParticles}
          linkDirectionalParticleColor={linkParticleColor}
          linkDirectionalParticleWidth={1.6}
          linkDirectionalParticleSpeed={0.006}
          linkLabel={(link: FGLink) => link.label}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onEngineStop={() => {
            // Frame the whole network once the first layout settles, so the
            // user always opens onto a structured, fully-visible map.
            if (!didInitialFit.current && nodes.length > 0) {
              fgRef.current?.zoomToFit(700, 90);
              didInitialFit.current = true;
            }
          }}
          cooldownTicks={200}
          warmupTicks={40}
        />
      )}
      {nodes.length > 0 && (
        <button
          type="button"
          onClick={() => {
            // Deliberate reset: clear the focus and re-frame the whole network.
            onNodeSelect(null);
            fgRef.current?.zoomToFit(800, 90);
          }}
          aria-label="Overview — clear focus and see the whole network"
          title="Overview"
          className="absolute right-4 top-16 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-canvas-border bg-canvas-surface/90 text-neutral-400 shadow-md backdrop-blur-sm transition-colors hover:text-neutral-100"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M5 1H1v4M9 1h4v4M5 13H1V9M9 13h4V9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
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
