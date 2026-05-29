// Lightweight graph observations over the already-loaded node and edge
// arrays. No DB calls, no extra dependencies. Used by the workspace to
// power the Insights drawer and surface bridge/gap suggestions.
//
// Design notes:
//   - Cheap O(n+m) passes over the in-memory graph.
//   - Stable, deterministic output so the UI doesn't reorder on every
//     render.
//   - Insight types are uniform so the UI can render a single list.

import type { GraphNode, GraphEdge } from "@/types";

export type InsightKind =
  | "isolated"
  | "hub"
  | "small_cluster"
  | "duplicate_title"
  | "bridge_candidate";

export type Insight =
  | {
      kind: "isolated";
      id: string;
      node: GraphNode;
    }
  | {
      kind: "hub";
      id: string;
      node: GraphNode;
      degree: number;
    }
  | {
      kind: "small_cluster";
      id: string;
      nodes: GraphNode[];
    }
  | {
      kind: "duplicate_title";
      id: string;
      nodes: GraphNode[];
    }
  | {
      kind: "bridge_candidate";
      id: string;
      a: GraphNode;
      b: GraphNode;
    };

function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    if (!adj.has(e.source_node_id) || !adj.has(e.target_node_id)) continue;
    adj.get(e.source_node_id)!.add(e.target_node_id);
    adj.get(e.target_node_id)!.add(e.source_node_id);
  }
  return adj;
}

function connectedComponents(
  nodes: GraphNode[],
  adj: Map<string, Set<string>>,
): GraphNode[][] {
  const visited = new Set<string>();
  const components: GraphNode[][] = [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));

  for (const start of nodes) {
    if (visited.has(start.id)) continue;
    const stack = [start.id];
    const component: GraphNode[] = [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (node) component.push(node);
      const neighbours = adj.get(id);
      if (neighbours) {
        for (const nb of neighbours) {
          if (!visited.has(nb)) stack.push(nb);
        }
      }
    }
    components.push(component);
  }
  return components;
}

// Normalise titles for cheap fuzzy comparison.
function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Jaccard similarity over word sets — fast, decent at catching near-
// duplicates without bringing in a Levenshtein library.
function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter((w) => w.length >= 3));
  const sb = new Set(b.split(" ").filter((w) => w.length >= 3));
  if (sa.size === 0 || sb.size === 0) return 0;
  let overlap = 0;
  for (const w of sa) if (sb.has(w)) overlap++;
  const union = sa.size + sb.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

export function deriveInsights(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Insight[] {
  const insights: Insight[] = [];
  if (nodes.length === 0) return insights;

  const adj = buildAdjacency(nodes, edges);

  // Isolated nodes (degree 0).
  const isolated: GraphNode[] = [];
  const degrees = new Map<string, number>();
  for (const n of nodes) {
    const d = adj.get(n.id)?.size ?? 0;
    degrees.set(n.id, d);
    if (d === 0) isolated.push(n);
  }
  for (const n of isolated) {
    insights.push({ kind: "isolated", id: `isolated:${n.id}`, node: n });
  }

  // Hubs — top 3 by degree, but only when their degree is at least 3
  // (otherwise "hub" is misleading).
  if (nodes.length >= 4) {
    const ranked = [...nodes]
      .map((n) => ({ node: n, degree: degrees.get(n.id) ?? 0 }))
      .filter((x) => x.degree >= 3)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 3);
    for (const { node, degree } of ranked) {
      insights.push({ kind: "hub", id: `hub:${node.id}`, node, degree });
    }
  }

  // Connected components — surface small clusters of size 2 or 3 that
  // sit apart from the rest of the graph.
  const components = connectedComponents(nodes, adj);
  for (const comp of components) {
    if (comp.length >= 2 && comp.length <= 3) {
      const id = `cluster:${comp
        .map((n) => n.id)
        .slice()
        .sort()
        .join(",")}`;
      insights.push({ kind: "small_cluster", id, nodes: comp });
    }
  }

  // Bridge candidates — pairs of non-trivial components (size >= 2 on
  // both sides) that share no edge. We surface at most three pairs to
  // avoid noise.
  const nonTrivial = components.filter((c) => c.length >= 2);
  let bridges = 0;
  outer: for (let i = 0; i < nonTrivial.length && bridges < 3; i++) {
    for (let j = i + 1; j < nonTrivial.length && bridges < 3; j++) {
      const a = nonTrivial[i];
      const b = nonTrivial[j];
      // Surface the highest-degree node from each side as the bridge
      // proposal — it's the most useful starting point for the AI.
      const pickRep = (xs: GraphNode[]) =>
        xs.reduce((best, n) =>
          (degrees.get(n.id) ?? 0) > (degrees.get(best.id) ?? 0) ? n : best,
        );
      const repA = pickRep(a);
      const repB = pickRep(b);
      insights.push({
        kind: "bridge_candidate",
        id: `bridge:${repA.id}:${repB.id}`,
        a: repA,
        b: repB,
      });
      bridges++;
      if (bridges >= 3) break outer;
    }
  }

  // Duplicate titles — Jaccard >= 0.6 on word sets is a conservative
  // match for "you wrote this thought twice". We group them so the UI
  // can offer a merge prompt later.
  const titles = nodes.map((n) => ({ node: n, norm: normalize(n.title) }));
  const matched = new Set<string>();
  for (let i = 0; i < titles.length; i++) {
    if (matched.has(titles[i].node.id)) continue;
    const group: GraphNode[] = [titles[i].node];
    for (let j = i + 1; j < titles.length; j++) {
      if (matched.has(titles[j].node.id)) continue;
      if (jaccard(titles[i].norm, titles[j].norm) >= 0.6) {
        group.push(titles[j].node);
        matched.add(titles[j].node.id);
      }
    }
    if (group.length >= 2) {
      matched.add(titles[i].node.id);
      const id = `duplicate:${group
        .map((n) => n.id)
        .slice()
        .sort()
        .join(",")}`;
      insights.push({ kind: "duplicate_title", id, nodes: group });
    }
  }

  return insights;
}

export function summarizeInsights(insights: Insight[]) {
  const counts = {
    isolated: 0,
    hub: 0,
    small_cluster: 0,
    duplicate_title: 0,
    bridge_candidate: 0,
  };
  for (const i of insights) {
    counts[i.kind]++;
  }
  return counts;
}

// Deterministic colour palette keyed by category. Six hues, dark-canvas
// friendly. Categories that hash to the same bucket share a hue, which
// is fine — the UI doesn't need perfect distinctness for MVP.
const CLUSTER_HUES = [
  { stroke: "#5eead4", glow: "rgba(94, 234, 212, 0.18)", bg: "rgba(20, 50, 50, 0.45)" }, // teal
  { stroke: "#fbbf24", glow: "rgba(251, 191, 36, 0.18)", bg: "rgba(60, 45, 10, 0.45)" }, // amber
  { stroke: "#a78bfa", glow: "rgba(167, 139, 250, 0.18)", bg: "rgba(40, 25, 60, 0.45)" }, // violet
  { stroke: "#f87171", glow: "rgba(248, 113, 113, 0.18)", bg: "rgba(60, 25, 25, 0.45)" }, // rose
  { stroke: "#60a5fa", glow: "rgba(96, 165, 250, 0.18)", bg: "rgba(20, 35, 60, 0.45)" }, // blue
  { stroke: "#4ade80", glow: "rgba(74, 222, 128, 0.18)", bg: "rgba(20, 50, 30, 0.45)" }, // green
];

function hashCategory(category: string): number {
  let h = 5381;
  const key = category.trim().toLowerCase() || "general";
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) + key.charCodeAt(i);
    h = h & 0xffffffff;
  }
  return Math.abs(h);
}

export function categoryColour(category: string) {
  const idx = hashCategory(category) % CLUSTER_HUES.length;
  return CLUSTER_HUES[idx];
}
