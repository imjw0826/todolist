// Deterministic decorative branches that emanate from each real node.
// Each branch is a sigmoid-style S-curve: horizontal tangent at both start AND end,
// matching d3.linkHorizontal so they read as "real-looking" branches.

export interface GhostBranch {
  path: string;
  endX: number;
  endY: number;
  endRadius: number;
  opacity: number;
  strokeWidth: number;
  delay: number;     // seconds — when the branch starts drawing
  growDuration: number; // seconds — how long the line takes to extend
  arcLen: number;    // rough arc length in px — used for stroke-dash animation
}

// mulberry32 PRNG — deterministic per node id
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Options {
  count: number;
  minLen: number;   // horizontal reach (always +x)
  maxLen: number;
  spreadY: number;  // total vertical spread (in px)
}

// Ghost density falls off as depth increases — top-level nodes get a lush
// halo, leaves stay quiet. All branches grow to the right (+x).
const DEFAULTS_BY_DEPTH: Record<number, Options> = {
  0: { count: 240, minLen: 180, maxLen: 380, spreadY: 520 },
  1: { count: 110, minLen: 130, maxLen: 280, spreadY: 360 },
  2: { count: 55,  minLen: 90,  maxLen: 200, spreadY: 220 },
  3: { count: 28,  minLen: 60,  maxLen: 140, spreadY: 140 },
  4: { count: 16,  minLen: 40,  maxLen: 100, spreadY: 90 },
};

function optsFor(depth: number): Options {
  return DEFAULTS_BY_DEPTH[depth] ?? DEFAULTS_BY_DEPTH[4];
}

/**
 * Build ghost branches in *local* coordinates (origin at the node).
 * Caller applies translate(node.y, node.x) at render time.
 *
 * Path uses two horizontal-tangent control points:
 *   M 0 0  C  midX 0,  midX endY,  endX endY
 * which is the exact d3.linkHorizontal sigmoid shape. Branch starts
 * horizontal, ends horizontal — same vocabulary as the real links.
 */
export function buildGhostBranches(
  nodeId: number,
  depth: number
): GhostBranch[] {
  const rng = makeRng(nodeId * 2654435761);
  const opts = optsFor(depth);
  const branches: GhostBranch[] = [];

  for (let i = 0; i < opts.count; i++) {
    const len = opts.minLen + rng() * (opts.maxLen - opts.minLen);
    const endX = len;
    // endY: roughly even fan with extra density near the center
    // use a slightly biased gaussian-ish: average of two uniforms
    const yNorm = (rng() + rng()) / 2 - 0.5; // ∈ (-0.5, 0.5), centered
    const endY = yNorm * opts.spreadY;

    // sigmoid control points — horizontal at both ends
    const midX = endX * 0.5;
    const path =
      `M 0 0 ` +
      `C ${midX.toFixed(2)} 0, ` +
      `${midX.toFixed(2)} ${endY.toFixed(2)}, ` +
      `${endX.toFixed(2)} ${endY.toFixed(2)}`;

    // Stagger: roughly ordered by index but with small random jitter so it
    // feels organic ("두두둑") rather than a clean wave.
    const baseStagger = i * 0.018;
    const jitter = rng() * 0.32;
    const delay = baseStagger + jitter;
    // Longer branches take a bit longer to draw — line speed roughly constant.
    const growDuration = 0.55 + (len / opts.maxLen) * 0.65;

    // Rough arc length of the sigmoid bezier — straight-line distance
    // times a factor that accounts for the S-curve detour.
    const straight = Math.hypot(endX, endY);
    const detour = 1 + Math.min(1.2, Math.abs(endY) / Math.max(endX, 1)) * 0.3;
    const arcLen = straight * detour;

    branches.push({
      path,
      endX,
      endY,
      endRadius: 0.6 + rng() * 1.1,
      opacity: 0.10 + rng() * 0.22,
      strokeWidth: 0.4 + rng() * 0.5,
      delay,
      growDuration,
      arcLen,
    });
  }

  return branches;
}
