import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { linkHorizontal } from "d3-shape";
import { pointer, select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { AnimatePresence, motion } from "framer-motion";
import { useTree } from "../hooks";
import { layout } from "../lib/layout";
import { useNodeReveal } from "../store";
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

/** Ids from the root down to `id`, inclusive; empty if not found. */
function pathTo(root: TreeNode, id: number): number[] {
  if (root.id === id) return [root.id];
  for (const c of root.children ?? []) {
    const p = pathTo(c, id);
    if (p.length) return [root.id, ...p];
  }
  return [];
}

function collectIds(node: TreeNode, into: Set<number>) {
  into.add(node.id);
  for (const c of node.children ?? []) collectIds(c, into);
}

const linkPath = linkHorizontal<unknown, { x: number; y: number }>()
  .x((d) => d.y)
  .y((d) => d.x);

function introDelay(depth: number, index: number) {
  return Math.min(depth * 0.16 + index * 0.018, 1.1);
}

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

// Time constant for wheel-zoom easing. Small enough to feel immediate,
// large enough that discrete wheel notches blend into continuous motion.
const ZOOM_TAU = 0.08;

export function MindMap() {
  const { data, isLoading, error } = useTree();
  // The set of node ids whose direct children are visible. Unexpanded nodes
  // render as leaves even if data has descendants. Single-level expansion is
  // a consequence: expanding a node never expands its grandchildren.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  // Starts the shared rAF loop. Held in a ref so effects declared before the
  // loop is built can still poke it.
  const kickRef = useRef<(() => void) | null>(null);
  // Last seen screen position for each node id — used so a node that mounts
  // on expansion springs in from the parent's *previous* position (where the
  // box was) rather than popping at the post-layout coordinates.
  const lastPos = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Node whose admin actions are pinned open by a tap (touch has no hover).
  const [touchActiveId, setTouchActiveId] = useState<number | null>(null);
  // Freshly created node to bring into view once it has been laid out.
  const [revealId, setRevealId] = useState<number | null>(null);
  const revealRaf = useRef(0);
  const [initializedTreeId, setInitializedTreeId] = useState<number | null>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const centeredRef = useRef(false);
  // The zoom transform lives in refs, not effect-locals, so a remount
  // (StrictMode, or `ready` flipping) doesn't snap the view back to identity.
  const targetTf = useRef<ViewTransform>({ x: 0, y: 0, k: 1 });
  const currentTf = useRef<ViewTransform>({ x: 0, y: 0, k: 1 });
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // On first data arrival, expand the full tree and focus the root.
  useEffect(() => {
    if (data && initializedTreeId !== data.id) {
      const allIds = new Set<number>();
      collectIds(data, allIds);
      lastPos.current.clear();
      centeredRef.current = false;
      setExpanded(allIds);
      setInitializedTreeId(data.id);
      setIntroComplete(false);
    }
  }, [data, initializedTreeId]);

  const treeReady = Boolean(
    data && initializedTreeId === data.id && expanded.has(data.id)
  );

  const laidOut = useMemo(
    () => (data && treeReady ? layout(data, expanded) : null),
    [data, expanded, treeReady]
  );

  // After each commit, snapshot the current screen position of every visible
  // node. Read on the *next* render to seed the mount position for any node
  // that just appeared, so it springs from the old spot.
  useEffect(() => {
    if (!laidOut) return;
    for (const n of laidOut.nodes) {
      lastPos.current.set(n.data.id, { x: n.y, y: n.x });
    }
  }, [laidOut]);

  useEffect(() => {
    if (!laidOut || introComplete) return;
    const timer = window.setTimeout(() => setIntroComplete(true), 1600);
    return () => window.clearTimeout(timer);
  }, [laidOut, introComplete]);

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

  // A node added from outside the map (the Jev bar): open every branch down
  // to its parent, then pan to it like a node added with the + button.
  const revealRequest = useNodeReveal((st) => st.request);
  const clearReveal = useNodeReveal((st) => st.clear);
  useEffect(() => {
    if (!revealRequest || !data) return;
    const path = pathTo(data, revealRequest.parentId);
    setExpanded((prev) => {
      if (path.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of path) next.add(id);
      return next;
    });
    setRevealId(revealRequest.nodeId);
    clearReveal();
  }, [revealRequest, data, clearReveal]);

  const ready = Boolean(laidOut);

  // Pan + zoom. d3-zoom owns the *target* transform; a rAF loop eases the
  // rendered transform toward it, so wheel notches read as continuous motion
  // instead of jumps.
  useLayoutEffect(() => {
    if (!ready) return;
    const svgEl = svgRef.current;
    const gEl = gRef.current;
    if (!svgEl || !gEl) return;

    const target = targetTf.current;
    const current = currentTf.current;
    // Screen point the wheel gesture is anchored on, plus the same point in
    // tree coordinates. Deriving x/y from these each frame keeps whatever is
    // under the cursor pinned there for the whole eased zoom.
    let anchor: { px: number; py: number; qx: number; qy: number } | null = null;
    let smoothing = false;
    let raf = 0;
    let lastTime = 0;

    const advance = (dt: number): boolean => {
      if (!smoothing || !anchor) {
        current.x = target.x;
        current.y = target.y;
        current.k = target.k;
        return false;
      }
      const a = 1 - Math.exp(-dt / ZOOM_TAU);
      // Interpolate scale geometrically — equal wheel notches then cover
      // equal visual steps, which is what makes it feel like a map.
      current.k = Math.exp(
        Math.log(current.k) + (Math.log(target.k) - Math.log(current.k)) * a
      );
      current.x = anchor.px - anchor.qx * current.k;
      current.y = anchor.py - anchor.qy * current.k;
      if (Math.abs(Math.log(target.k / current.k)) < 4e-4) {
        current.x = target.x;
        current.y = target.y;
        current.k = target.k;
        smoothing = false;
        anchor = null;
        return false;
      }
      return true;
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(Math.max((now - (lastTime || now)) / 1000, 0), 1 / 30);
      lastTime = now;

      const viewMoving = advance(dt);
      gEl.setAttribute(
        "transform",
        `translate(${current.x},${current.y}) scale(${current.k})`
      );
      if (viewMoving) kick();
    };

    const kick = () => {
      if (raf) return;
      raf = requestAnimationFrame(frame);
    };
    kickRef.current = kick;

    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 2.5])
      .on("zoom", (event) => {
        const t = event.transform;
        target.x = t.x;
        target.y = t.y;
        target.k = t.k;
        const src = event.sourceEvent as Event | null | undefined;
        // Trackpad pinch (a wheel event with ctrlKey) is direct manipulation
        // like a drag — easing it would read as the map lagging your fingers.
        // Only discrete wheel notches get smoothed.
        const isWheelNotch =
          !!src && src.type === "wheel" && !(src as WheelEvent).ctrlKey;
        if (isWheelNotch) {
          const [px, py] = pointer(src, svgEl);
          anchor = { px, py, qx: (px - t.x) / t.k, qy: (py - t.y) / t.k };
          smoothing = true;
        } else {
          // Drags and pinches are direct manipulation — easing them would
          // just feel like lag, so they track the pointer exactly.
          smoothing = false;
          anchor = null;
        }
        kick();
      });

    zoomRef.current = z;
    const sel = select(svgEl).call(z);

    // Restore whatever transform was already in effect (StrictMode remount,
    // or a re-attach after the tree changed).
    const existing = zoomIdentity
      .translate(current.x, current.y)
      .scale(current.k);
    sel.call(z.transform, existing);
    kick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      sel.on(".zoom", null);
      zoomRef.current = null;
      kickRef.current = null;
    };
  }, [ready]);

  // Pan (without zooming) so a newly created node is on screen. New nodes
  // often land past the viewport edge, which made adding look like it failed.
  useEffect(() => {
    if (revealId == null || !laidOut) return;
    const svgEl = svgRef.current;
    const z = zoomRef.current;
    const n = laidOut.nodes.find((x) => x.data.id === revealId);
    if (!svgEl || !z || !n) return;
    setRevealId(null);

    const rect = svgEl.getBoundingClientRect();
    const { x: tx, y: ty, k } = targetTf.current;
    const sx = n.y * k + tx;
    const sy = n.x * k + ty;
    const margin = 120;
    const dx =
      sx < margin ? margin - sx : sx > rect.width - margin ? rect.width - margin - sx : 0;
    const dy =
      sy < margin ? margin - sy : sy > rect.height - margin ? rect.height - margin - sy : 0;
    if (!dx && !dy) return;

    // Short eased pan driven through d3-zoom so its state stays in sync.
    // The frame handle lives in a ref: clearing revealId above re-runs this
    // effect, and a cleanup-based cancel would kill the pan before it starts.
    const from = { x: tx, y: ty };
    const start = performance.now();
    const duration = 450;
    cancelAnimationFrame(revealRaf.current);
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      select(svgEl).call(
        z.transform,
        zoomIdentity.translate(from.x + dx * e, from.y + dy * e).scale(k)
      );
      revealRaf.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    revealRaf.current = requestAnimationFrame(step);
  }, [revealId, laidOut]);

  useEffect(() => () => cancelAnimationFrame(revealRaf.current), []);

  // Auto-fit once, on the first full-tree layout.
  useLayoutEffect(() => {
    if (!laidOut || centeredRef.current) return;
    const svgEl = svgRef.current;
    const z = zoomRef.current;
    if (!svgEl || !z) return;

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
    const scale = Math.max(0.25, Math.min(1.45, Math.min(scaleX, scaleY)));
    const cx = (minSx + maxSx) / 2;
    const cy = (minSy + maxSy) / 2;
    const tx = rect.width / 2 - cx * scale;
    const ty = rect.height / 2 - cy * scale;
    select(svgEl).call(
      z.transform,
      zoomIdentity.translate(tx, ty).scale(scale)
    );
    centeredRef.current = true;
  }, [laidOut]);

  if (isLoading) {
    return <div className="loading">불러오는 중…</div>;
  }
  if (error || !data) {
    return <div className="loading">데이터를 불러올 수 없습니다.</div>;
  }
  if (!treeReady || !laidOut) {
    return <div className="loading">불러오는 중…</div>;
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
      <svg
        ref={svgRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          background: "transparent",
        }}
        onClick={(e) => {
          // A tap on empty canvas closes any pinned admin actions.
          if (e.target === e.currentTarget) setTouchActiveId(null);
        }}
      >
        <g ref={gRef}>
          <g className="link-layer">
            <AnimatePresence>
              {laidOut.links.map((link, index) => {
                const d = linkPath({
                  source: { x: link.source.x, y: link.source.y },
                  target: { x: link.target.x, y: link.target.y },
                }) as string;
                const delay = introComplete
                  ? 0
                  : introDelay(link.target.depth, index) + 0.06;
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
                      opacity: { duration: 0.4, ease: "easeOut", delay },
                    }}
                  />
                );
              })}
            </AnimatePresence>
          </g>

          <g className="node-layer">
            <AnimatePresence>
              {laidOut.nodes.map((n, index) => {
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
                  } else if (!introComplete) {
                    initialX = n.parent.y;
                    initialY = n.parent.x;
                  }
                }
                return (
                  <MindMapNode
                    key={`node-${n.data.id}`}
                    node={n}
                    expanded={expanded.has(n.data.id)}
                    hasChildrenInData={dataHasChildren}
                    boxWidth={laidOut.columnWidths[n.depth]}
                    touchActive={touchActiveId === n.data.id}
                    onTouchSelect={setTouchActiveId}
                    onToggle={toggle}
                    ensureExpanded={ensureExpanded}
                    onCreated={setRevealId}
                    initialX={initialX}
                    initialY={initialY}
                    enterDelay={introComplete ? 0 : introDelay(n.depth, index)}
                  />
                );
              })}
            </AnimatePresence>
          </g>
        </g>
      </svg>
    </div>
  );
}
