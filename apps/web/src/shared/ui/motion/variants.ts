import type { Transition, Variants } from "motion/react";

export const momoEaseOut = [0.16, 1, 0.3, 1] as const;

export const momoTransition = {
  duration: 0.18,
  ease: momoEaseOut,
} satisfies Transition;

export const momoPanelTransition = {
  duration: 0.2,
  ease: momoEaseOut,
} satisfies Transition;

export const momoSpring = {
  bounce: 0,
  duration: 0.2,
  type: "spring",
} satisfies Transition;

export const panelRevealVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
} satisfies Variants;

export const shieldRevealVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
} satisfies Variants;
