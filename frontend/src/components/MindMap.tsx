import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { linkHorizontal } from "d3-shape";
import { pointer, select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { AnimatePresence, motion } from "framer-motion";
import { useTree } from "../hooks";
import { layout } from "../lib/layout";
import { GhostRenderer, type GhostTarget, type ViewTransform } from "../lib/ghostRenderer";
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

function introDelay(depth: number, index: number) {
  return Math.min(depth * 0.16 + index * 0.018, 1.1);
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
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GhostRenderer | null>(null);
  // Starts the shared rAF loop. Held in a ref so effects declared before the
  // loop is built can still poke it.
  const kickRef = useRef<(() => void) | null>(null);
  // Last seen screen position for each node id — used so a ghost group that
  // mounts on expansion springs in from the parent's *previous* position
  // (where the box was) rather than popping at the post-layout coordinates.
  const lastPos = useRef<Map<number, { x: number; y: number }>>(new Map());
  // First paint? On the very first render the root ghost should bloom right
  // away; later expansions wait briefly so the children spring into place
  // before their halo starts reaching outward.
  const hasPaintedOnce = useRef(false);
  const [initializedTreeId, setInitializedTreeId] = useState<number | null>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const centeredRef = useRef(false);
  // The zoom transform lives in refs, not effect-locals, so a remount
  // (StrictMode, or `ready` flipping) doesn't snap the view back to identity.
  const targetTf = useRef<ViewTransform>({ x: 0, y: 0, k: 1 });
  const currentTf = useRef<ViewTransform>({ x: 0, y: 0, k: 1 });
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const ghostTargetsRef = useRef<GhostTarget[]>([]);

  // On first data arrival, expand the full tree and focus the root.
  useEffect(() => {
    if (data && initializedTreeId !== data.id) {
      const allIds = new Set<number>();
      collectIds(data, allIds);
      lastPos.current.clear();
      hasPaintedOnce.current = false;
      centeredRef.current = false;
      setExpanded(allIds);
      setFocusedId(data.id);
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

  const focusedDepth = useMemo(() => {
    if (!laidOut || focusedId == null) return null;
    const n = laidOut.nodes.find((x) => x.data.id === focusedId);
    return n ? n.depth : null;
  }, [laidOut, focusedId]);

  // Ghost spawn positions have to be read during render, before the snapshot
  // effect below overwrites lastPos with the new layout.
  const ghostTargets = useMemo<GhostTarget[]>(() => {
    if (!laidOut) return [];
    return laidOut.nodes
      .filter(
        (n) => expanded.has(n.data.id) && (n.data.children?.length ?? 0) > 0
      )
      .map((n, index) => {
        const prev = lastPos.current.get(n.data.id);
        return {
          id: n.data.id,
          depth: n.depth,
          x: n.y,
          y: n.x,
          spawnX: prev?.x ?? n.y,
          spawnY: prev?.y ?? n.x,
          enterDelay: introComplete
            ? hasPaintedOnce.current
              ? 0.45
              : 0
            : introDelay(n.depth, index) + 0.12,
        };
      });
  }, [laidOut, expanded, introComplete]);

  ghostTargetsRef.current = ghostTargets;

  // After each commit, snapshot the current screen position of every visible
  // node. Read on the *next* render to seed the mount position for any node or
  // ghost group that just appeared, so it springs from the old spot.
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

  const ready = Boolean(laidOut);

  // Pan + zoom. d3-zoom owns the *target* transform; a rAF loop eases the
  // rendered transform toward it and repaints the ghost canvas in the same
  // frame, so wheel notches read as continuous motion instead of jumps.
  useLayoutEffect(() => {
    if (!ready) return;
    const svgEl = svgRef.current;
    const gEl = gRef.current;
    const canvasEl = canvasRef.current;
    if (!svgEl || !gEl || !canvasEl) return;

    const renderer = new GhostRenderer(canvasEl);
    rendererRef.current = renderer;
    // The ghost effect below is keyed on the target list, which hasn't
    // changed on a remount — seed the new renderer directly instead.
    renderer.setGroups(ghostTargetsRef.current);

    const target = targetTf.current;
    const current = currentTf.current;
    // Screen point the wheel gesture is anchored on, plus the same point in
    // tree coordinates. Deriving x/y from these each frame keeps whatever is
    // under the cursor pinned there for the whole eased zoom.
    let anchor: { px: number; py: number; qx: number; qy: number } | null = null;
    let smoothing = false;
    let raf = 0;
    let lastTime = 0;

    const syncCanvas = () => {
      const rect = svgEl.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    syncCanvas();

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
      const ghostsMoving = renderer.step(dt);
      renderer.draw(current);
      gEl.setAttribute(
        "transform",
        `translate(${current.x},${current.y}) scale(${current.k})`
      );
      if (viewMoving || ghostsMoving) kick();
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

    const ro = new ResizeObserver(() => {
      syncCanvas();
      kick();
    });
    ro.observe(svgEl);

    // Restore whatever transform was already in effect (StrictMode remount,
    // or a re-attach after the tree changed).
    const existing = zoomIdentity
      .translate(current.x, current.y)
      .scale(current.k);
    sel.call(z.transform, existing);
    kick();

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      sel.on(".zoom", null);
      zoomRef.current = null;
      kickRef.current = null;
      rendererRef.current = null;
    };
  }, [ready]);

  // Feed the ghost layer. Separate from the zoom setup so layout changes
  // don't tear down and rebuild the zoom behaviour.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setGroups(ghostTargets);
    kickRef.current?.();
  }, [ghostTargets]);

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
      {/* Ghost halos live on a canvas: ~700 decorative beziers are far too
          expensive to re-rasterize as SVG on every zoom frame. */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          pointerEvents: "none",
        }}
      />
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
                    focused={focusedId === n.data.id}
                    focusedDepth={focusedDepth}
                    onToggle={toggle}
                    ensureExpanded={ensureExpanded}
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
