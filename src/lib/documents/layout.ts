// Cluster layout for an uploaded document.
// Root sits at the cluster centre; sections fan out radially with spacing that
// scales to the section count; each section's child nodes are placed on
// concentric arcs pointing away from the root so they never crash into it or
// each other. Deterministic — no randomness — so re-renders are stable.

export type DocumentClusterLayout = {
  root: { x: number; y: number };
  sections: { section_id: string; x: number; y: number }[];
  childPositionFor: (
    sectionId: string,
    childIndex: number,
    childTotal: number,
  ) => { position_x: number; position_y: number };
};

// Minimum on-canvas spacing between node centres (node boxes are ~176px wide).
const MIN_SECTION_SPACING = 300;
const BASE_SECTION_RADIUS = 620;
// Child arc geometry.
const CHILD_BASE_RADIUS = 230;
const CHILD_RING_STEP = 170;
const CHILD_SWEEP_RAD = (300 * Math.PI) / 180;
// Concentric ring capacities: first ring holds 6, each subsequent ring +4.
const FIRST_RING_CAPACITY = 6;
const RING_CAPACITY_STEP = 4;

// Resolve which ring a child sits in, and its index/total within that ring,
// so children spread over multiple arcs instead of crowding one circle.
function ringFor(childIndex: number): {
  ring: number;
  indexInRing: number;
  ringTotal: number;
} {
  let remaining = childIndex;
  let ring = 0;
  for (;;) {
    const capacity = FIRST_RING_CAPACITY + ring * RING_CAPACITY_STEP;
    if (remaining < capacity) {
      return { ring, indexInRing: remaining, ringTotal: capacity };
    }
    remaining -= capacity;
    ring += 1;
  }
}

export function computeDocumentClusterLayout(args: {
  sectionIds: string[];
  centerX: number;
  centerY: number;
}): DocumentClusterLayout {
  const root = { x: args.centerX, y: args.centerY };
  const n = Math.max(args.sectionIds.length, 1);

  // Grow the section ring so the arc length between neighbours stays readable:
  // arcLength ≈ 2πR / n  ≥  MIN_SECTION_SPACING.
  const sectionRadius = Math.max(
    BASE_SECTION_RADIUS,
    (MIN_SECTION_SPACING * n) / (2 * Math.PI),
  );

  const sectionPositions = new Map<
    string,
    { x: number; y: number; angle: number }
  >();
  const sections: { section_id: string; x: number; y: number }[] = [];

  for (let i = 0; i < args.sectionIds.length; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const x = root.x + Math.cos(angle) * sectionRadius;
    const y = root.y + Math.sin(angle) * sectionRadius;
    sectionPositions.set(args.sectionIds[i], { x, y, angle });
    sections.push({ section_id: args.sectionIds[i], x, y });
  }

  const childPositionFor = (
    sectionId: string,
    childIndex: number,
    childTotal: number,
  ) => {
    const sec = sectionPositions.get(sectionId);
    if (!sec) {
      return { position_x: root.x, position_y: root.y };
    }
    const { ring, indexInRing, ringTotal } = ringFor(childIndex);
    // Only spread within the ring across as many slots as are actually used.
    const usedInRing = Math.min(
      ringTotal,
      Math.max(childTotal - ringStartIndex(ring), 1),
    );
    const radius = CHILD_BASE_RADIUS + ring * CHILD_RING_STEP;
    const outwardAngle = sec.angle;
    const span = usedInRing === 1 ? 0 : CHILD_SWEEP_RAD;
    const step = usedInRing === 1 ? 0 : span / (usedInRing - 1);
    const startAngle = outwardAngle - span / 2;
    const angle = startAngle + step * indexInRing;
    return {
      position_x: sec.x + Math.cos(angle) * radius,
      position_y: sec.y + Math.sin(angle) * radius,
    };
  };

  return { root, sections, childPositionFor };
}

// Index of the first child that lands in a given ring.
function ringStartIndex(ring: number): number {
  let total = 0;
  for (let r = 0; r < ring; r++) {
    total += FIRST_RING_CAPACITY + r * RING_CAPACITY_STEP;
  }
  return total;
}
