import { describe, it, expect } from "vitest";

import { declutterPositions, type LayoutNode } from "./declutter";

describe("declutterPositions", () => {
  it("returns nothing for fewer than two nodes", () => {
    expect(declutterPositions([])).toEqual([]);
    expect(
      declutterPositions([{ id: "a", position_x: 0, position_y: 0 }]),
    ).toEqual([]);
  });

  it("leaves already well-spaced nodes untouched", () => {
    const nodes: LayoutNode[] = [
      { id: "a", position_x: 0, position_y: 0 },
      { id: "b", position_x: 1000, position_y: 1000 },
    ];
    expect(declutterPositions(nodes)).toEqual([]);
  });

  it("separates overlapping nodes until their boxes clear on an axis", () => {
    const start = [
      { id: "a", position_x: 0, position_y: 0 },
      { id: "b", position_x: 10, position_y: 0 },
    ];
    const moves = declutterPositions(start);
    expect(moves.length).toBeGreaterThan(0);

    // Merge the moves back over the originals, then assert the pair no longer
    // overlaps on BOTH axes (boxes are 210 x 120). The relaxation resolves
    // along the axis of least penetration, so either axis may be the one that
    // ends up clear.
    const finalPos = new Map(start.map((n) => [n.id, { x: n.position_x, y: n.position_y }]));
    for (const m of moves) finalPos.set(m.id, { x: m.position_x, y: m.position_y });
    const a = finalPos.get("a")!;
    const b = finalPos.get("b")!;
    const clearedX = Math.abs(b.x - a.x) >= 210 - 1;
    const clearedY = Math.abs(b.y - a.y) >= 120 - 1;
    expect(clearedX || clearedY).toBe(true);
  });

  it("is deterministic across runs", () => {
    const nodes: LayoutNode[] = [
      { id: "a", position_x: 0, position_y: 0 },
      { id: "b", position_x: 0, position_y: 0 },
      { id: "c", position_x: 20, position_y: 10 },
    ];
    expect(declutterPositions(nodes)).toEqual(declutterPositions(nodes));
  });
});
