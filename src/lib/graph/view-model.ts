// Client-safe graph view model.
//
// The canvas should never render the whole database at once. This module
// derives which nodes are visible given the current view mode, the selected
// node, and which documents the user has chosen to expand. It is pure and
// deterministic — no DB access, no React — so it can be unit-reasoned and
// reused on the server later if needed.

export type GraphViewMode = "focus" | "global";

export type ViewModelNode = {
  id: string;
  origin: string;
};

export type ViewModelEdge = {
  source_node_id: string;
  target_node_id: string;
};

const DOCUMENT_CHILD_ORIGINS = new Set(["document_section", "document_ai"]);

export function isDocumentRoot(origin: string): boolean {
  return origin === "document_root";
}

export function isDocumentChild(origin: string): boolean {
  return DOCUMENT_CHILD_ORIGINS.has(origin);
}

// Neighbours one hop away from `id`.
export function neighborsOf(
  edges: ViewModelEdge[],
  id: string,
): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.source_node_id === id) out.add(e.target_node_id);
    if (e.target_node_id === id) out.add(e.source_node_id);
  }
  return out;
}

// Neighbours within two hops (inclusive of one-hop).
export function secondDegreeOf(
  edges: ViewModelEdge[],
  id: string,
): Set<string> {
  const first = neighborsOf(edges, id);
  const out = new Set<string>(first);
  for (const n of first) {
    for (const m of neighborsOf(edges, n)) out.add(m);
  }
  return out;
}

export type ComputeVisibleArgs = {
  nodes: ViewModelNode[];
  edges: ViewModelEdge[];
  mode: GraphViewMode;
  selectedNodeId: string | null;
  expandBranch: boolean;
  // Document ids the user has expanded; their section + concept nodes show.
  expandedDocumentIds: Set<string>;
  // nodeId -> documentId, for document-owned nodes (root, section, concept).
  documentMembership: Record<string, string>;
};

// Returns the set of node ids that should be visible on the canvas.
export function computeVisibleNodeIds(args: ComputeVisibleArgs): Set<string> {
  const {
    nodes,
    edges,
    mode,
    selectedNodeId,
    expandBranch,
    expandedDocumentIds,
    documentMembership,
  } = args;

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Focus mode with a selection: drill into the neighbourhood and ignore the
  // collapse rule — the user explicitly chose this node.
  if (mode === "focus" && selectedNodeId && nodeIds.has(selectedNodeId)) {
    const hood = expandBranch
      ? secondDegreeOf(edges, selectedNodeId)
      : neighborsOf(edges, selectedNodeId);
    hood.add(selectedNodeId);
    const out = new Set<string>();
    for (const id of hood) if (nodeIds.has(id)) out.add(id);
    return out;
  }

  // Otherwise apply the document-collapse rule: a document's section/concept
  // nodes are hidden unless that document is expanded. Roots always show.
  const out = new Set<string>();
  for (const n of nodes) {
    if (isDocumentChild(n.origin)) {
      const docId = documentMembership[n.id];
      if (docId && expandedDocumentIds.has(docId)) {
        out.add(n.id);
      }
      // collapsed child → hidden
    } else {
      out.add(n.id);
    }
  }
  return out;
}
