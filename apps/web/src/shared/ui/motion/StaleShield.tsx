import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { momoPanelTransition, shieldRevealVariants } from "@/shared/ui/motion/variants";

type StaleShieldProps = {
  active: boolean;
  busyLabel?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  contentClassName?: string | undefined;
  fallback: ReactNode;
  preserveContent?: boolean | undefined;
};

export function StaleShield({
  active,
  busyLabel = "表示を更新中",
  children,
  className,
  contentClassName,
  fallback,
  preserveContent = false,
}: StaleShieldProps) {
  if (preserveContent) {
    return (
      <div
        aria-busy={active || undefined}
        className={cn("relative min-w-0", className)}
        data-stale={active || undefined}
      >
        <motion.div
          animate={{ opacity: active ? 0.62 : 1 }}
          className={cn("min-w-0", contentClassName)}
          inert={active || undefined}
          transition={momoPanelTransition}
        >
          {children}
        </motion.div>
        <AnimatePresence initial={false}>
          {active ? (
            <motion.div
              key="busy-status"
              animate={{ opacity: 1, y: 0 }}
              className="pointer-events-none absolute inset-x-0 top-3 flex justify-center"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: -4 }}
              transition={momoPanelTransition}
            >
              <span
                className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-muted)] shadow-[var(--shadow-sm)]"
                role="status"
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
                {busyLabel}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

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
