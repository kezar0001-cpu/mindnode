import type { GraphNode, GraphEdge } from "@/types";

// A client-side description of how a mutation changed the graph. Server
// actions return the affected rows; the workspace merges them into local
// state immediately instead of waiting on a full route refresh.
export type GraphDelta = {
  upsertNodes?: GraphNode[];
  removeNodeIds?: string[];
  upsertEdges?: GraphEdge[];
  removeEdgeIds?: string[];
};
