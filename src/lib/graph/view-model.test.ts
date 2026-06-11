import { describe, it, expect } from "vitest";

import {
  neighborsOf,
  descendantsOf,
  computeVisibleNodeIds,
  type ViewModelEdge,
  type ViewModelNode,
} from "./view-model";

const edges: ViewModelEdge[] = [
  { source_node_id: "a", target_node_id: "b" },
  { source_node_id: "b", target_node_id: "c" },
  { source_node_id: "c", target_node_id: "a" }, // cycle back to a
  { source_node_id: "a", target_node_id: "d" },
];

describe("neighborsOf", () => {
  it("returns one-hop neighbours in both directions", () => {
    expect(neighborsOf(edges, "a")).toEqual(new Set(["b", "c", "d"]));
    expect(neighborsOf(edges, "b")).toEqual(new Set(["a", "c"]));
  });

  it("returns an empty set for an unknown node", () => {
    expect(neighborsOf(edges, "zzz").size).toBe(0);
  });
});

describe("descendantsOf", () => {
  it("follows source -> target and excludes the root", () => {
    // a -> b -> c -> a (cycle), a -> d
    const result = descendantsOf(edges, "a");
    expect(result).toEqual(new Set(["b", "c", "d"]));
    expect(result.has("a")).toBe(false);
  });

  it("is cycle-safe and terminates", () => {
    const cyclic: ViewModelEdge[] = [
      { source_node_id: "x", target_node_id: "y" },
      { source_node_id: "y", target_node_id: "x" },
    ];
    expect(descendantsOf(cyclic, "x")).toEqual(new Set(["y"]));
  });
});

describe("computeVisibleNodeIds", () => {
  const nodes: ViewModelNode[] = [
    { id: "a", origin: "memory" },
    { id: "b", origin: "memory" },
    { id: "c", origin: "memory" },
    { id: "d", origin: "memory" },
  ];

  const base = {
    nodes,
    edges,
    expandBranch: false,
    expandedDocumentIds: new Set<string>(),
    documentMembership: {},
    collapsedNodeIds: new Set<string>(),
  };

  it("shows the whole graph in global mode", () => {
    const visible = computeVisibleNodeIds({
      ...base,
      mode: "global",
      selectedNodeId: null,
    });
    expect(visible).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("narrows to the selected neighbourhood in focus mode", () => {
    const visible = computeVisibleNodeIds({
      ...base,
      mode: "focus",
      selectedNodeId: "b",
    });
    // b plus its neighbours a and c — not d.
    expect(visible).toEqual(new Set(["a", "b", "c"]));
  });

  it("hides descendants of a contracted node in global mode", () => {
    const visible = computeVisibleNodeIds({
      ...base,
      mode: "global",
      selectedNodeId: null,
      collapsedNodeIds: new Set(["a"]),
    });
    // a stays (so it can be re-expanded); its branch b/c/d is hidden.
    expect(visible.has("a")).toBe(true);
    expect(visible.has("b")).toBe(false);
    expect(visible.has("d")).toBe(false);
  });

  it("hides document children until the document is expanded", () => {
    const docNodes: ViewModelNode[] = [
      { id: "root", origin: "document_root" },
      { id: "sec", origin: "document_section" },
      { id: "concept", origin: "document_ai" },
    ];
    const membership = { root: "doc1", sec: "doc1", concept: "doc1" };

    const collapsed = computeVisibleNodeIds({
      ...base,
      nodes: docNodes,
      edges: [],
      mode: "global",
      selectedNodeId: null,
      documentMembership: membership,
    });
    expect(collapsed).toEqual(new Set(["root"]));

    const expanded = computeVisibleNodeIds({
      ...base,
      nodes: docNodes,
      edges: [],
      mode: "global",
      selectedNodeId: null,
      documentMembership: membership,
      expandedDocumentIds: new Set(["doc1"]),
    });
    expect(expanded).toEqual(new Set(["root", "sec", "concept"]));
  });
});
