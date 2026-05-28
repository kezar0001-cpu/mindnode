"use client";

import { useState } from "react";

import { Canvas } from "@/components/canvas/Canvas";
import { NodeDetail } from "@/components/nodes/node-detail";
import type { GraphNode, GraphEdge } from "@/types";
import type { MemoryTrailMap } from "@/lib/graph/queries";

type MindWorkspaceProps = {
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  memoryTrails: MemoryTrailMap;
};

export function MindWorkspace({
  initialNodes,
  initialEdges,
  memoryTrails,
}: MindWorkspaceProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  return (
    <>
      <section
        aria-label="Canvas"
        className="relative min-h-[55vh] flex-1 overflow-hidden bg-canvas-bg lg:min-h-0"
      >
        <div className="absolute inset-0">
          <Canvas
            dbNodes={initialNodes}
            dbEdges={initialEdges}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
          />
        </div>
      </section>

      <aside
        aria-label="Node detail"
        className="flex flex-col gap-3 overflow-y-auto border-t border-canvas-border bg-canvas-surface p-4 sm:p-5 lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0"
      >
        <NodeDetail
          selectedNodeId={selectedNodeId}
          nodes={initialNodes}
          memoryTrails={memoryTrails}
        />
      </aside>
    </>
  );
}
