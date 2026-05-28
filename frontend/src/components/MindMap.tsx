import { useEffect, useMemo, useRef, useState } from "react";
import { linkHorizontal } from "d3-shape";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { AnimatePresence, motion } from "framer-motion";
import { useTree } from "../hooks";
import { layout } from "../lib/layout";
import { GhostBranches } from "./GhostBranches";
import { MindMapNode } from "./MindMapNode";
import type { TreeNode } from "../types";

function findInTree(root: TreeNode, id: number): TreeNode | null {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const r = findInTree(c, id);
    if (r) return r;
  }
  return null;
}

function findParent(root: TreeNode, id: number): TreeNode | null {
  for (const c of root.children ?? []) {
    if (c.id === id) return root;
    const r = findParent(c, id);
    if (r) return r;
  }
  return null;
}

function collectIds(node: TreeNode, into: Set<number>) {
  into.add(node.id);
  for (const c of node.children ?? []) collectIds(c, into);
}

const linkPath = linkHorizontal<unknown, { x: number; y: number }>()
  .x((d) => d.y)
  .y((d) => d.x);

export function MindMap() {
  const { data, isLoading, error } = useTree();
  // The set of node ids whose direct children are visible. Unexpanded nodes
  // render as leaves even if data has descendants. Single-level expansion is
  // a consequence: expanding a node never expands its grandchildren.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const ghostLayerRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last seen screen position for each node id — used so a ghost group that
  // mounts on expansion springs in from the parent's *previous* position
  // (where the box was) rather than popping at the post-layout coordinates.
  const lastPos = useRef<Map<number, { x: number; y: number }>>(new Map());
  // First paint? On the very first render the root ghost should bloom right
  // away; later expansions wait briefly so the children spring into place
  // before their halo starts reaching outward.
  const hasPaintedOnce = useRef(false);

  // On first data arrival, expand only the root and focus it.
  useEffect(() => {
    if (data && expanded.size === 0) {
      setExpanded(new Set([data.id]));
      setFocusedId(data.id);
    }
  }, [data, expanded.size]);

  const laidOut = useMemo(
    () => (data ? layout(data, expanded) : null),
    [data, expanded]
  );

  const focusedDepth = useMemo(() => {
    if (!laidOut || focusedId == null) return null;
    const n = laidOut.nodes.find((x) => x.data.id === focusedId);
    return n ? n.depth : null;
  }, [laidOut, focusedId]);

  // After each commit, snapshot the current screen position of every visible
  // node. Read on the *next* render to seed framer-motion's initial for any
  // ghost group that just mounted, so it springs from the node's old spot.
  useEffect(() => {
    if (!laidOut) return;
    for (const n of laidOut.nodes) {
      lastPos.current.set(n.data.id, { x: n.y, y: n.x });
    }
    // 자식 노드가 실제로 화면에 등장한 뒤에만 true로 설정.
    // 루트만 있는 초기 렌더에서는 false를 유지해 첫 화면에서
    // 노드와 고스트가 함께 나타나도록 한다.
    if (laidOut.nodes.length > 1) {
      hasPaintedOnce.current = true;
    }
  }, [laidOut]);

  const toggle = (id: number) => {
    const wasExpanded = expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (wasExpanded) {
        // Collapsing — also drop all descendants so re-expanding only
        // reveals direct children, not the previous deeper state.
        if (data) {
          const target = findInTree(data, id);
          if (target) {
            const drop = new Set<number>();
            collectIds(target, drop);
            for (const did of drop) next.delete(did);
          } else {
            next.delete(id);
          }
        } else {
          next.delete(id);
        }
      } else {
        next.add(id);
      }
      return next;
    });
    // Collapse moves focus up to the parent so this node shrinks back to its
    // resting size. Expansion focuses the node itself.
    if (wasExpanded) {
      const parent = data ? findParent(data, id) : null;
      setFocusedId(parent ? parent.id : data?.id ?? null);
    } else {
      setFocusedId(id);
    }
  };

  // After mutations (add child), keep the parent expanded so the new node
  // is visible. Triggered by external add — the toggle callback handles
  // the manual case.
  const ensureExpanded = (parentId: number) => {
    setExpanded((prev) => {
      if (prev.has(parentId)) return prev;
      const next = new Set(prev);
      next.add(parentId);
      return next;
    });
  };

  // Pan + zoom, with an auto-fit on first layout.
  const centeredRef = useRef(false);
  useEffect(() => {
    if (!svgRef.current || !gRef.current || !laidOut) return;
    const svgEl = svgRef.current;
    const gEl = gRef.current;

    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 2.5])
      .on("zoom", (event) => {
        gEl.setAttribute("transform", event.transform.toString());

        // zoom 중에는 ghost layer를 즉시 숨겨 렌더 부하를 줄인다.
        // React state를 쓰면 re-render가 발생해 오히려 느려지므로 ref로 직접 조작.
        const ghost = ghostLayerRef.current;
        if (ghost) {
          ghost.style.opacity = "0";
          ghost.style.transition = "none";
        }
        if (zoomEndTimer.current) clearTimeout(zoomEndTimer.current);
        zoomEndTimer.current = setTimeout(() => {
          if (ghost) {
            ghost.style.transition = "opacity 0.4s ease";
            ghost.style.opacity = "1";
          }
        }, 120);
      });
    zoomRef.current = z;
    const sel = select(svgEl).call(z);

    if (!centeredRef.current) {
      const rect = svgEl.getBoundingClientRect();
      let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
      for (const n of laidOut.nodes) {
        if (n.y < minSx) minSx = n.y;
        if (n.y > maxSx) maxSx = n.y;
        if (n.x < minSy) minSy = n.x;
        if (n.x > maxSy) maxSy = n.x;
      }
      minSx -= 100;
      maxSx += 200;
      minSy -= 80;
      maxSy += 80;
      const treeW = Math.max(maxSx - minSx, 200);
      const treeH = Math.max(maxSy - minSy, 200);
      const padding = 60;
      const scaleX = (rect.width - padding * 2) / treeW;
      const scaleY = (rect.height - padding * 2) / treeH;
      const scale = Math.max(0.6, Math.min(1.6, Math.min(scaleX, scaleY)));
      const cx = (minSx + maxSx) / 2;
      const cy = (minSy + maxSy) / 2;
      const tx = rect.width / 2 - cx * scale;
      const ty = rect.height / 2 - cy * scale;
      sel.call(z.transform, zoomIdentity.translate(tx, ty).scale(scale));
      centeredRef.current = true;
    }

    return () => {
      select(svgEl).on(".zoom", null);
    };
  }, [laidOut]);

  if (isLoading) {
    return <div className="loading">불러오는 중…</div>;
  }
  if (error || !data || !laidOut) {
    return <div className="loading">데이터를 불러올 수 없습니다.</div>;
  }

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      style={{ display: "block", background: "var(--bg)" }}
    >
      <g ref={gRef} style={{ willChange: "transform" }}>
        {/* Ghost branches — only for nodes that are currently expanded so
            collapsing a parent also retracts its decorative halo. */}
        <g className="ghost-layer" ref={ghostLayerRef}>
          <AnimatePresence>
            {laidOut.nodes
              .filter((n) => expanded.has(n.data.id))
              .map((n) => {
                const prev = lastPos.current.get(n.data.id);
                const initialX = prev?.x ?? n.y;
                const initialY = prev?.y ?? n.x;
                return (
                  <motion.g
                    key={`ghost-${n.data.id}`}
                    initial={{ x: initialX, y: initialY, opacity: 1 }}
                    animate={{ x: n.y, y: n.x, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      x: { type: "spring", stiffness: 180, damping: 22 },
                      y: { type: "spring", stiffness: 180, damping: 22 },
                      opacity: { duration: 0.35, ease: "easeOut" },
                    }}
                  >
                    <GhostBranches
                      nodeId={n.data.id}
                      depth={n.depth}
                      enterDelay={hasPaintedOnce.current ? 0.45 : 0}
                    />
                  </motion.g>
                );
              })}
          </AnimatePresence>
        </g>

        <g className="link-layer">
          <AnimatePresence>
            {laidOut.links.map((link) => {
              const d = linkPath({
                source: { x: link.source.x, y: link.source.y },
                target: { x: link.target.x, y: link.target.y },
              }) as string;
              return (
                <motion.path
                  key={`link-${link.target.data.id}`}
                  fill="none"
                  stroke="#2c2c2c"
                  strokeWidth={0.95}
                  strokeLinecap="round"
                  initial={{ d, opacity: 0 }}
                  animate={{ d, opacity: 0.55 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    d: { type: "spring", stiffness: 160, damping: 22 },
                    opacity: { duration: 0.4, ease: "easeOut" },
                  }}
                />
              );
            })}
          </AnimatePresence>
        </g>

        <g className="node-layer">
          <AnimatePresence>
            {laidOut.nodes.map((n) => {
              const dataHasChildren = (n.data.children?.length ?? 0) > 0;
              // Pick the mount-time position. If the node was already visible
              // last render, reuse its last position. If it's newly visible
              // (just appeared via expansion), inherit the parent's previous
              // spot so it flies out from there instead of popping in place.
              const prev = lastPos.current.get(n.data.id);
              let initialX = n.y;
              let initialY = n.x;
              if (prev) {
                initialX = prev.x;
                initialY = prev.y;
              } else if (n.parent) {
                const parentPrev = lastPos.current.get(n.parent.data.id);
                if (parentPrev) {
                  initialX = parentPrev.x;
                  initialY = parentPrev.y;
                }
              }
              return (
                <MindMapNode
                  key={`node-${n.data.id}`}
                  node={n}
                  expanded={expanded.has(n.data.id)}
                  hasChildrenInData={dataHasChildren}
                  focused={focusedId === n.data.id}
                  focusedDepth={focusedDepth}
                  onToggle={toggle}
                  ensureExpanded={ensureExpanded}
                  initialX={initialX}
                  initialY={initialY}
                />
              );
            })}
          </AnimatePresence>
        </g>
      </g>
    </svg>
  );
}
