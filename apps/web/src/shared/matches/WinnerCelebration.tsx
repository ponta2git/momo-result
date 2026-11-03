import { Trophy } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";

import {
  celebrationMarkTransition,
  celebrationShineTransition,
  celebrationSurfaceTransition,
} from "@/shared/ui/motion/transitions";

const settled = { opacity: 1, rotate: 0, scale: 1 } as const;

/**
 * The surface a confirmed match lays under its winner (UI rule: 節目の演出). It only decorates:
 * the result renders at once above it, the motion plays when it mounts and never on a refetch,
 * and reduced motion shows the settled surface without the shine. The parent owns the border,
 * corner radius, and an isolated stacking context.
 */
export function WinnerCelebrationSurface() {
  const reduceMotion = useReducedMotionConfig();
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
    >
      <m.span
        className="absolute inset-0 bg-[var(--color-celebration-surface)]"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={celebrationSurfaceTransition}
      />
      {reduceMotion ? null : (
        <m.span
          className="absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(105deg,transparent,var(--color-celebration-shine),transparent)]"
          initial={{ x: "-100%" }}
          animate={{ x: "300%" }}
          transition={celebrationShineTransition}
        />
      )}
    </span>
  );
}

/** The winner's mark; the visible `1位` and the surface carry the meaning without it. */
export function WinnerCelebrationMark() {
  const reduceMotion = useReducedMotionConfig();
  return (
    <m.span
      aria-hidden="true"
      className="inline-flex shrink-0 text-[var(--color-celebration-mark)]"
      initial={reduceMotion ? false : { opacity: 0, rotate: -12, scale: 0.4 }}
      animate={settled}
      transition={celebrationMarkTransition}
    >
      <Trophy className="size-6" />
    </m.span>
  );
}
