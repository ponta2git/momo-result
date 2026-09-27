import { domMin, LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

import { useMediaQuery } from "@/shared/lib/useMediaQuery";

type AppMotionProviderProps = {
  children: ReactNode;
};

/** Provides the single, deliberately small Motion feature bundle used by the application. */
export function AppMotionProvider({ children }: AppMotionProviderProps) {
  // Motion's current useReducedMotion captures the preference at mount. Subscribe here so
  // every mounted visual consumer receives preference changes without losing its task state.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  return (
    <LazyMotion features={domMin} strict>
      <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>{children}</MotionConfig>
    </LazyMotion>
  );
}
