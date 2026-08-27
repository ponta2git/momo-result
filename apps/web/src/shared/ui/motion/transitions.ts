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
