import { describe, it, expect } from "vitest";

import {
  CaptureSuggestionSchema,
  sanitizeCaptureSuggestion,
  type CaptureSuggestion,
} from "./suggest-schema";

function make(partial: Partial<CaptureSuggestion>): CaptureSuggestion {
  return {
    action: "create_node",
    title: "A thought",
    summary: "A summary",
    category: "general",
    confidence: 0.8,
    target_node_id: null,
    suggested_edges: [],
    explanation: "because",
    ...partial,
  };
}

describe("CaptureSuggestionSchema", () => {
  it("accepts a well-formed create suggestion and defaults edges", () => {
    const parsed = CaptureSuggestionSchema.safeParse({
      action: "create_node",
      title: "T",
      summary: "S",
      category: "ideas",
      confidence: 0.5,
      explanation: "why",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.suggested_edges).toEqual([]);
  });

  it("rejects an unknown action and out-of-range confidence", () => {
    expect(
      CaptureSuggestionSchema.safeParse(make({ action: "delete" as never })).success,
    ).toBe(false);
    expect(
      CaptureSuggestionSchema.safeParse(make({ confidence: 1.5 })).success,
    ).toBe(false);
  });
});

describe("sanitizeCaptureSuggestion", () => {
  const candidates = new Set(["n1", "n2"]);

  it("downgrades update_node to create_node when the target is not a candidate", () => {
    const out = sanitizeCaptureSuggestion(
      make({ action: "update_node", target_node_id: "ghost" }),
      candidates,
    );
    expect(out.action).toBe("create_node");
    expect(out.target_node_id).toBeNull();
  });

  it("keeps a valid update target", () => {
    const out = sanitizeCaptureSuggestion(
      make({ action: "update_node", target_node_id: "n1" }),
      candidates,
    );
    expect(out.action).toBe("update_node");
    expect(out.target_node_id).toBe("n1");
  });

  it("drops edges to unknown ids", () => {
    const out = sanitizeCaptureSuggestion(
      make({
        suggested_edges: [
          { target_node_id: "n2", relationship_type: "relates to" },
          { target_node_id: "unknown", relationship_type: "relates to" },
        ],
      }),
      candidates,
    );
    expect(out.suggested_edges.map((e) => e.target_node_id)).toEqual(["n2"]);
  });

  it("drops an edge that points at the update target itself", () => {
    const out = sanitizeCaptureSuggestion(
      make({
        action: "update_node",
        target_node_id: "n1",
        suggested_edges: [{ target_node_id: "n1", relationship_type: "x" }],
      }),
      candidates,
    );
    expect(out.suggested_edges).toEqual([]);
  });

  it("caps suggested edges at three", () => {
    const big = new Set(["a", "b", "c", "d", "e"]);
    const out = sanitizeCaptureSuggestion(
      make({
        suggested_edges: ["a", "b", "c", "d", "e"].map((id) => ({
          target_node_id: id,
          relationship_type: "r",
        })),
      }),
      big,
    );
    expect(out.suggested_edges).toHaveLength(3);
  });
});
