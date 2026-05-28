import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "../types";

export interface LaidOutTree {
  nodes: HierarchyPointNode<TreeNode>[];
  links: { source: HierarchyPointNode<TreeNode>; target: HierarchyPointNode<TreeNode> }[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

// Deterministic small PRNG, seeded per-node so the jitter is stable across renders.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the visible portion of the tree based on the `expanded` set.
 * A node's children are included iff its id is in `expanded` — so an
 * unexpanded node renders as a leaf even if it has descendants in data.
 */
export function layout(
  data: TreeNode,
  expanded: Set<number>
): LaidOutTree {
  const root = hierarchy<TreeNode>(data, (d) =>
    expanded.has(d.id) ? d.children : null
  );

  const layoutFn = tree<TreeNode>().nodeSize([72, 320]);
  const positioned = layoutFn(root);

  // Add gentle vertical jitter to break the grid feel. Each node gets a
  // deterministic offset based on its id, so the same tree always lays out
  // the same way and links don't dance when state changes elsewhere.
  for (const n of positioned.descendants()) {
    if (n.depth === 0) continue; // keep root anchored
    const rng = seeded(n.data.id * 0x9e3779b1);
    const xJitter = (rng() - 0.5) * 22; // ±11 px vertically (screen-Y)
    const yJitter = (rng() - 0.5) * 60; // ±30 px horizontally (screen-X)
    n.x += xJitter;
    n.y += yJitter;
  }

  const nodes = positioned.descendants();
  const links = positioned.links();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }

  return { nodes, links, bounds: { minX, maxX, minY, maxY } };
}
