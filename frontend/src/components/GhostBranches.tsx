import { usePresence } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { buildGhostBranches } from "../lib/ghosts";

interface Props {
  nodeId: number;
  depth: number;
  // Seconds to wait before any branch starts drawing. Used so a ghost halo
  // that mounts because a parent just expanded doesn't appear at the children's
  // destinations before the children have flown out there.
  enterDelay?: number;
}

export function GhostBranches({ nodeId, depth, enterDelay = 0 }: Props) {
  const branches = useMemo(
    () => buildGhostBranches(nodeId, depth),
    [nodeId, depth]
  );

  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  // Track the in-flight enter animations so we can cancel them when the
  // group is being removed and start a fresh retract instead.
  const enterAnims = useRef<Animation[]>([]);

  const [isPresent, safeToRemove] = usePresence();

  // Enter: stagger each branch's stroke-dashoffset from arcLen → 0 plus the
  // tip dot's scale 0 → 1. Web Animations API is the only reliable path here
  // because framer-motion can't animate strokeDashoffset on SVG.
  useEffect(() => {
    if (!isPresent) return; // skip enter when component is exiting
    const anims: Animation[] = [];
    pathRefs.current.forEach((p, i) => {
      const b = branches[i];
      if (!p || !b) return;
      const a = p.animate(
        [
          { strokeDashoffset: b.arcLen },
          { strokeDashoffset: 0 },
        ],
        {
          duration: b.growDuration * 1000,
          delay: (enterDelay + b.delay) * 1000,
          easing: "ease-out",
          fill: "both",
        }
      );
      anims.push(a);
    });
    dotRefs.current.forEach((c, i) => {
      const b = branches[i];
      if (!c || !b) return;
      const a = c.animate(
        [
          { opacity: 0, transform: "scale(0)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        {
          duration: 220,
          delay: (enterDelay + b.delay + b.growDuration * 0.85) * 1000,
          easing: "ease-out",
          fill: "both",
        }
      );
      anims.push(a);
    });
    enterAnims.current = anims;
    return () => {
      anims.forEach((a) => a.cancel());
    };
  }, [branches, isPresent]);

  // Exit: when AnimatePresence tells us we're leaving, run the reverse —
  // dashoffset back up to arcLen, tip dot fades out. After every animation
  // settles we call safeToRemove so React actually unmounts.
  useEffect(() => {
    if (isPresent) return;
    // Whatever enter anims were running, cancel them and read the current
    // computed dashoffset so the retract starts from where the line is now.
    enterAnims.current.forEach((a) => a.cancel());

    const exitAnims: Animation[] = [];
    let remaining = 0;
    const done = () => {
      remaining--;
      if (remaining <= 0) safeToRemove?.();
    };

    pathRefs.current.forEach((p, i) => {
      const b = branches[i];
      if (!p || !b) return;
      const current =
        parseFloat(getComputedStyle(p).strokeDashoffset) || 0;
      // Slightly faster retract than the grow; reverse-staggered so the
      // outer leaves disappear first, trunk last.
      const retractDelay = (branches.length - 1 - i) * 0.004;
      const a = p.animate(
        [
          { strokeDashoffset: current },
          { strokeDashoffset: b.arcLen },
        ],
        {
          duration: 300,
          delay: retractDelay * 1000,
          easing: "ease-in",
          fill: "forwards",
        }
      );
      exitAnims.push(a);
      remaining++;
      a.addEventListener("finish", done);
    });

    dotRefs.current.forEach((c, i) => {
      if (!c) return;
      const a = c.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0)" },
        ],
        {
          duration: 220,
          easing: "ease-in",
          fill: "forwards",
        }
      );
      exitAnims.push(a);
    });

    // Fallback in case there were no paths at all.
    if (remaining === 0) safeToRemove?.();

    return () => {
      exitAnims.forEach((a) => a.cancel());
    };
  }, [isPresent, branches, safeToRemove]);

  return (
    <g className="ghosts" pointerEvents="none">
      {branches.map((b, i) => (
        <g key={i}>
          <path
            ref={(el) => {
              pathRefs.current[i] = el;
            }}
            d={b.path}
            fill="none"
            stroke="#2c2c2c"
            strokeWidth={b.strokeWidth}
            strokeOpacity={b.opacity}
            strokeLinecap="round"
            strokeDasharray={b.arcLen}
            strokeDashoffset={b.arcLen}
          />
          <circle
            ref={(el) => {
              dotRefs.current[i] = el;
            }}
            cx={b.endX}
            cy={b.endY}
            r={b.endRadius}
            fill="#2c2c2c"
            fillOpacity={b.opacity * 1.4}
            opacity={0}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        </g>
      ))}
    </g>
  );
}
