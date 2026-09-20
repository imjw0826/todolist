import { buildGhostBranches, type GhostBranch } from "./ghosts";

// Ghost branches are purely decorative and never hit-tested, which makes them
// a bad fit for retained-mode SVG: ~700 dashed beziers force the browser to
// re-flatten and re-rasterize every path on every zoom frame (measured at
// ~50ms/frame). Drawing them into a single canvas instead keeps the zoom
// transform off the vector-rasterization path entirely.

const COLOR = "44, 44, 44"; // #2c2c2c
const STIFFNESS = 180; // matches the springs the real nodes still use
const DAMPING = 22;
const EXIT_SEC = 0.3;
const DOT_SEC = 0.22;
const NO_DASH: number[] = [];
const TWO_PI = Math.PI * 2;

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface GhostTarget {
  id: number;
  depth: number;
  /** Destination in tree coordinates (screen-space before the zoom transform). */
  x: number;
  y: number;
  /** Where a freshly-added group springs in from — usually the parent's last spot. */
  spawnX: number;
  spawnY: number;
  enterDelay: number;
}

interface Group {
  id: number;
  branches: GhostBranch[];
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  enterDelay: number;
  elapsed: number;
  exiting: boolean;
  exitElapsed: number;
  /** Seconds after enterDelay at which every branch and dot has finished. */
  settleAt: number;
}

interface StrokeBucket {
  path: Path2D;
  width: number;
  alpha: number;
}

interface DotBucket {
  path: Path2D;
  alpha: number;
}

interface Cache {
  strokes: StrokeBucket[];
  dots: DotBucket[];
}

const easeOut = (p: number) => 1 - (1 - p) * (1 - p);
const easeIn = (p: number) => p * p;

export class GhostRenderer {
  private ctx: CanvasRenderingContext2D;
  private groups: Group[] = [];
  private byId = new Map<number, Group>();
  /**
   * Once every branch has finished growing and every group has come to rest,
   * the whole layer collapses into a handful of Path2D objects bucketed by
   * stroke width and opacity. A settled frame is then a few dozen stroke()
   * calls instead of ~1400 individual ones — this is what makes zooming cheap.
   */
  private cache: Cache | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  resize(w: number, h: number, dpr: number) {
    if (this.w === w && this.h === h && this.dpr === dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setGroups(targets: GhostTarget[]) {
    const seen = new Set<number>();

    for (const t of targets) {
      seen.add(t.id);
      const existing = this.byId.get(t.id);

      if (!existing) {
        const branches = buildGhostBranches(t.id, t.depth);
        let settleAt = 0;
        for (const b of branches) {
          const grown = b.delay + b.growDuration;
          const dotted = b.delay + b.growDuration * 0.85 + DOT_SEC;
          settleAt = Math.max(settleAt, grown, dotted);
        }
        const g: Group = {
          id: t.id,
          branches,
          tx: t.x,
          ty: t.y,
          cx: t.spawnX,
          cy: t.spawnY,
          vx: 0,
          vy: 0,
          enterDelay: t.enterDelay,
          elapsed: 0,
          exiting: false,
          exitElapsed: 0,
          settleAt,
        };
        this.byId.set(t.id, g);
        this.groups.push(g);
        this.cache = null;
        continue;
      }

      if (existing.exiting) {
        // Re-expanded before the retract finished — resume rather than restart.
        existing.exiting = false;
        existing.exitElapsed = 0;
        this.cache = null;
      }
      if (existing.tx !== t.x || existing.ty !== t.y) {
        existing.tx = t.x;
        existing.ty = t.y;
        this.cache = null;
      }
    }

    for (const g of this.groups) {
      if (!seen.has(g.id) && !g.exiting) {
        g.exiting = true;
        g.exitElapsed = 0;
        this.cache = null;
      }
    }
  }

  /** Advance one frame. Returns true while anything is still moving. */
  step(dt: number): boolean {
    let animating = false;

    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      g.elapsed += dt;

      if (g.exiting) {
        g.exitElapsed += dt;
        if (g.exitElapsed >= EXIT_SEC + 0.05) {
          this.groups.splice(i, 1);
          this.byId.delete(g.id);
          this.cache = null;
          continue;
        }
        animating = true;
      }

      const atRest =
        Math.abs(g.tx - g.cx) < 0.01 &&
        Math.abs(g.ty - g.cy) < 0.01 &&
        Math.abs(g.vx) < 0.01 &&
        Math.abs(g.vy) < 0.01;

      if (atRest) {
        g.cx = g.tx;
        g.cy = g.ty;
        g.vx = 0;
        g.vy = 0;
      } else {
        // Sub-step so a dropped frame can't blow the spring up.
        const steps = Math.max(1, Math.ceil(dt / 0.008));
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
          g.vx += ((g.tx - g.cx) * STIFFNESS - g.vx * DAMPING) * h;
          g.vy += ((g.ty - g.cy) * STIFFNESS - g.vy * DAMPING) * h;
          g.cx += g.vx * h;
          g.cy += g.vy * h;
        }
        animating = true;
        this.cache = null;
      }

      if (!g.exiting && g.elapsed < g.enterDelay + g.settleAt) {
        animating = true;
        this.cache = null;
      }
    }

    if (!animating && !this.cache) this.buildCache();
    return animating;
  }

  draw(tf: ViewTransform) {
    const { ctx, dpr, w, h } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.groups.length === 0) return;

    ctx.setTransform(dpr * tf.k, 0, 0, dpr * tf.k, dpr * tf.x, dpr * tf.y);
    ctx.lineCap = "round";

    if (this.cache) this.drawCached();
    else this.drawLive();
  }

  private drawCached() {
    const { ctx, cache } = this;
    if (!cache) return;
    ctx.setLineDash(NO_DASH);
    for (const s of cache.strokes) {
      ctx.lineWidth = s.width;
      ctx.strokeStyle = `rgba(${COLOR},${s.alpha})`;
      ctx.stroke(s.path);
    }
    for (const d of cache.dots) {
      ctx.fillStyle = `rgba(${COLOR},${d.alpha})`;
      ctx.fill(d.path);
    }
  }

  private drawLive() {
    const { ctx } = this;
    for (const g of this.groups) {
      const gAlpha = g.exiting
        ? Math.max(0, 1 - g.exitElapsed / EXIT_SEC)
        : 1;
      if (gAlpha <= 0) continue;

      ctx.save();
      ctx.translate(g.cx, g.cy);
      const n = g.branches.length;

      for (let i = 0; i < n; i++) {
        const b = g.branches[i];
        const p = this.branchProgress(g, b, i, n);
        if (p > 0) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(b.c1x, b.c1y, b.c2x, b.c2y, b.endX, b.endY);
          if (p < 1) {
            ctx.setLineDash([b.arcLen, b.arcLen]);
            ctx.lineDashOffset = b.arcLen * (1 - p);
          } else {
            ctx.setLineDash(NO_DASH);
          }
          ctx.lineWidth = b.strokeWidth;
          ctx.strokeStyle = `rgba(${COLOR},${b.opacity * gAlpha})`;
          ctx.stroke();
        }

        const dp = this.dotProgress(g, b);
        if (dp > 0) {
          ctx.beginPath();
          ctx.arc(b.endX, b.endY, b.endRadius * dp, 0, TWO_PI);
          ctx.fillStyle = `rgba(${COLOR},${
            Math.min(1, b.opacity * 1.4) * gAlpha * dp
          })`;
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  private branchProgress(
    g: Group,
    b: GhostBranch,
    i: number,
    n: number
  ): number {
    const t = g.elapsed - g.enterDelay - b.delay;
    let p = t <= 0 ? 0 : easeOut(Math.min(1, t / b.growDuration));
    if (g.exiting) {
      // Reverse-staggered retract: outer leaves pull back first, trunk last.
      const et = Math.max(0, g.exitElapsed - (n - 1 - i) * 0.004);
      p *= 1 - easeIn(Math.min(1, et / EXIT_SEC));
    }
    return p;
  }

  private dotProgress(g: Group, b: GhostBranch): number {
    const t = g.elapsed - g.enterDelay - b.delay - b.growDuration * 0.85;
    let dp = t <= 0 ? 0 : Math.min(1, t / DOT_SEC);
    if (g.exiting) dp *= Math.max(0, 1 - g.exitElapsed / DOT_SEC);
    return dp;
  }

  private buildCache() {
    const strokes = new Map<string, StrokeBucket>();
    const dots = new Map<string, DotBucket>();

    for (const g of this.groups) {
      for (const b of g.branches) {
        // Quantise so many branches collapse into one Path2D per style.
        const width = Math.round(b.strokeWidth * 20) / 20;
        const alpha = Math.round(b.opacity * 40) / 40;
        const key = `${width}|${alpha}`;
        let s = strokes.get(key);
        if (!s) {
          s = { path: new Path2D(), width, alpha };
          strokes.set(key, s);
        }
        s.path.moveTo(g.cx, g.cy);
        s.path.bezierCurveTo(
          g.cx + b.c1x,
          g.cy + b.c1y,
          g.cx + b.c2x,
          g.cy + b.c2y,
          g.cx + b.endX,
          g.cy + b.endY
        );

        const dAlpha = Math.round(Math.min(1, b.opacity * 1.4) * 40) / 40;
        const dKey = String(dAlpha);
        let d = dots.get(dKey);
        if (!d) {
          d = { path: new Path2D(), alpha: dAlpha };
          dots.set(dKey, d);
        }
        const cx = g.cx + b.endX;
        const cy = g.cy + b.endY;
        d.path.moveTo(cx + b.endRadius, cy);
        d.path.arc(cx, cy, b.endRadius, 0, TWO_PI);
      }
    }

    this.cache = {
      strokes: [...strokes.values()],
      dots: [...dots.values()],
    };
  }
}
