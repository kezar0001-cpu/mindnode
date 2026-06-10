// Deterministic declutter pass for hand-made (or import-piled) tangles.
//
// Pure geometry — no React, no DB. Given node positions, it pushes
// overlapping node boxes apart with an iterative relaxation until they clear a
// minimum spacing, then returns only the nodes whose position actually moved.
// Deterministic: same input always yields the same output (ties broken by id),
// so repeated runs converge instead of jittering.

export type LayoutNode = {
  id: string;
  position_x: number;
  position_y: number;
};

// Node boxes are ~176px wide / ~64px tall; pad to a comfortable gap.
const MIN_X = 210;
const MIN_Y = 120;
const ITERATIONS = 60;
// A move smaller than this is treated as noise and not persisted.
const MOVE_EPSILON = 1;

export function declutterPositions(
  input: LayoutNode[],
): { id: string; position_x: number; position_y: number }[] {
  const n = input.length;
  if (n < 2) return [];

  // Work on a copy, ordered by id so the relaxation is deterministic.
  const nodes = [...input]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((node) => ({
      id: node.id,
      x: node.position_x,
      y: node.position_y,
      ox: node.position_x,
      oy: node.position_y,
    }));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;

        // Exact overlap — nudge deterministically using index parity so the
        // pair separates instead of dividing by zero.
        if (dx === 0 && dy === 0) {
          dx = (j % 2 === 0 ? 1 : -1) * 0.5;
          dy = (i % 2 === 0 ? 1 : -1) * 0.5;
        }

        const overlapX = MIN_X - Math.abs(dx);
        const overlapY = MIN_Y - Math.abs(dy);
        // Only collide when boxes overlap on BOTH axes.
        if (overlapX <= 0 || overlapY <= 0) continue;

        // Resolve along the axis of least penetration — cheaper push, less
        // disturbance to the user's arrangement.
        if (overlapX < overlapY) {
          const shift = (overlapX / 2) * (dx >= 0 ? 1 : -1);
          a.x -= shift;
          b.x += shift;
        } else {
          const shift = (overlapY / 2) * (dy >= 0 ? 1 : -1);
          a.y -= shift;
          b.y += shift;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  const out: { id: string; position_x: number; position_y: number }[] = [];
  for (const node of nodes) {
    if (
      Math.abs(node.x - node.ox) > MOVE_EPSILON ||
      Math.abs(node.y - node.oy) > MOVE_EPSILON
    ) {
      out.push({
        id: node.id,
        position_x: Math.round(node.x),
        position_y: Math.round(node.y),
      });
    }
  }
  return out;
}
