// Cluster layout for an uploaded document.
// Root sits at the cluster centre; sections fan out radially; each
// section's child nodes are placed on a smaller arc pointing away from
// the root so they never crash into it.

export type DocumentClusterLayout = {
  root: { x: number; y: number };
  sections: { section_id: string; x: number; y: number }[];
  childPositionFor: (
    sectionId: string,
    childIndex: number,
    childTotal: number,
  ) => { position_x: number; position_y: number };
};

const SECTION_RADIUS = 360;
const CHILD_RADIUS = 140;
const CHILD_SWEEP_RAD = (270 * Math.PI) / 180;

export function computeDocumentClusterLayout(args: {
  sectionIds: string[];
  centerX: number;
  centerY: number;
}): DocumentClusterLayout {
  const root = { x: args.centerX, y: args.centerY };
  const n = Math.max(args.sectionIds.length, 1);

  const sectionPositions = new Map<
    string,
    { x: number; y: number; angle: number }
  >();
  const sections: { section_id: string; x: number; y: number }[] = [];

  for (let i = 0; i < args.sectionIds.length; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const x = root.x + Math.cos(angle) * SECTION_RADIUS;
    const y = root.y + Math.sin(angle) * SECTION_RADIUS;
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
    // Anchor of the child arc points outward (away from root).
    const outwardAngle = sec.angle;
    const safeTotal = Math.max(childTotal, 1);
    // Sweep is centred on the outward angle; if there's only one child it
    // sits exactly outward.
    const span = safeTotal === 1 ? 0 : CHILD_SWEEP_RAD;
    const step = safeTotal === 1 ? 0 : span / (safeTotal - 1);
    const startAngle = outwardAngle - span / 2;
    const angle = startAngle + step * childIndex;
    return {
      position_x: sec.x + Math.cos(angle) * CHILD_RADIUS,
      position_y: sec.y + Math.sin(angle) * CHILD_RADIUS,
    };
  };

  return { root, sections, childPositionFor };
}
