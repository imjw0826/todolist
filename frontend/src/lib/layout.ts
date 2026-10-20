import { hierarchy, type HierarchyNode, type HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "../types";

export interface LaidOutTree {
  nodes: HierarchyPointNode<TreeNode>[];
  links: { source: HierarchyPointNode<TreeNode>; target: HierarchyPointNode<TreeNode> }[];
  /** Box width shared by every node in a column, indexed by depth. */
  columnWidths: number[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

// Vertical distance between rows, and horizontal gap between the right edge
// of one column and the left edge of the next.
const ROW_HEIGHT = 56;
const COLUMN_GAP = 140;

export function nodeMetrics(depth: number) {
  const isRoot = depth === 0;
  const isTrunk = depth <= 1;
  const fontSize = isRoot ? 14 : isTrunk ? 13 : 12;
  const padX = isTrunk ? 12 : 10;
  const padY = isTrunk ? 7 : 6;
  return { fontSize, padX, padY, boxH: fontSize + padY * 2 };
}

// Rough width per character for the node-label font. CJK glyphs are ~font-size
// wide; ASCII is narrower. Used so node boxes hug their label.
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    const wide = ch.charCodeAt(0) > 0x2e80;
    w += wide ? fontSize : fontSize * 0.58;
  }
  return Math.max(w, fontSize * 2);
}

/**
 * Build the visible portion of the tree based on the `expanded` set.
 * A node's children are included iff its id is in `expanded` — so an
 * unexpanded node renders as a leaf even if it has descendants in data.
 *
 * Nodes sit on a strict grid: each column (depth) has one x and one box
 * width, and every node lands on a whole row. Leaves take consecutive rows;
 * a parent takes the middle row of its children's span (the upper middle
 * when the count is even), so it is always level with one of its children.
 */
export function layout(
  data: TreeNode,
  expanded: Set<number>
): LaidOutTree {
  const root = hierarchy<TreeNode>(data, (d) =>
    expanded.has(d.id) ? d.children : null
  );

  // Column widths: the widest label at each depth decides the whole column.
  const columnWidths: number[] = [];
  root.each((n) => {
    const { fontSize, padX } = nodeMetrics(n.depth);
    const w = estimateTextWidth(n.data.title, fontSize) + padX * 2;
    columnWidths[n.depth] = Math.max(columnWidths[n.depth] ?? 0, w);
  });

  const columnX: number[] = [0];
  for (let d = 1; d < columnWidths.length; d++) {
    columnX[d] =
      columnX[d - 1] + columnWidths[d - 1] / 2 + COLUMN_GAP + columnWidths[d] / 2;
  }

  // Assign rows bottom-up in visit order.
  let nextLeafRow = 0;
  const assign = (n: HierarchyNode<TreeNode>): number => {
    let row: number;
    if (!n.children || n.children.length === 0) {
      row = nextLeafRow++;
    } else {
      const rows = n.children.map(assign);
      row = rows[Math.floor((rows.length - 1) / 2)];
    }
    const p = n as HierarchyPointNode<TreeNode>;
    // d3 convention used throughout the app: x is vertical, y is horizontal.
    p.x = row * ROW_HEIGHT;
    p.y = columnX[n.depth];
    return row;
  };
  const rootRow = assign(root);

  // Keep the root at the origin so the view anchor doesn't drift as rows change.
  const positioned = root as HierarchyPointNode<TreeNode>;
  const offset = rootRow * ROW_HEIGHT;
  for (const n of positioned.descendants()) n.x -= offset;

  const nodes = positioned.descendants();
  const links = positioned.links();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }

  return { nodes, links, columnWidths, bounds: { minX, maxX, minY, maxY } };
}
