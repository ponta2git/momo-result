import { domMin, LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

type AppMotionProviderProps = {
  children: ReactNode;
};

/** Provides the single, deliberately small Motion feature bundle used by the application. */
export function AppMotionProvider({ children }: AppMotionProviderProps) {
  return (
    <LazyMotion features={domMin} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
