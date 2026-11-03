import type { Transition } from "motion/react";

export const politeMotionTransition = {
  duration: 0.12,
  ease: [0.16, 1, 0.3, 1],
  type: "tween",
} as const satisfies Transition;

export const instantMotionTransition = {
  duration: 0,
  type: "tween",
} as const satisfies Transition;

/** Surface feedback has a gentler onset than the existing indicator/presence motion. */
export const surfaceHoverTransition = {
  duration: 0.1,
  ease: [0, 0, 0.58, 1],
  type: "tween",
} as const;

/**
 * A milestone moment plays once and only decorates: the surface settles in, a single shine
 * crosses it, and the mark lands with a small overshoot. Results never wait for these.
 */
export const celebrationSurfaceTransition = {
  duration: 0.6,
  ease: [0.16, 1, 0.3, 1],
  type: "tween",
} as const satisfies Transition;

export const celebrationShineTransition = {
  delay: 0.3,
  duration: 1.1,
  ease: [0.4, 0, 0.2, 1],
  type: "tween",
} as const satisfies Transition;

export const celebrationMarkTransition = {
  bounce: 0.45,
  delay: 0.15,
  duration: 0.7,
  type: "spring",
} as const satisfies Transition;
