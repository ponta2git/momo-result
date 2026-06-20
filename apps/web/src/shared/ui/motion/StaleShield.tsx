import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { momoPanelTransition, shieldRevealVariants } from "@/shared/ui/motion/variants";

type StaleShieldProps = {
  active: boolean;
  children: ReactNode;
  className?: string | undefined;
  contentClassName?: string | undefined;
  fallback: ReactNode;
};

export function StaleShield({
  active,
  children,
  className,
  contentClassName,
  fallback,
}: StaleShieldProps) {
  return (
    <div aria-busy={active || undefined} className={cn("min-w-0", className)}>
      <AnimatePresence initial={false} mode="wait">
        {active ? (
          <motion.div
            key="shield"
            animate="visible"
            exit="hidden"
            initial="hidden"
            className={cn("min-w-0", contentClassName)}
            transition={momoPanelTransition}
            variants={shieldRevealVariants}
          >
            {fallback}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            animate="visible"
            exit="hidden"
            initial="hidden"
            className={cn("min-w-0", contentClassName)}
            transition={momoPanelTransition}
            variants={shieldRevealVariants}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
