import { Progress as BaseProgress } from "@base-ui/react/progress";
import { m, useReducedMotionConfig } from "motion/react";

import { cn } from "@/shared/ui/cn";
import { instantMotionTransition, politeMotionTransition } from "@/shared/ui/motion/transitions";

type ProgressBarProps = {
  "aria-label": string;
  "aria-valuetext"?: string | undefined;
  className?: string | undefined;
  max: number;
  value: number;
};

function normalizedProgress(value: number, max: number) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const finiteValue = Number.isFinite(value) ? value : 0;
  const clampedValue = Math.min(Math.max(finiteValue, 0), safeMax);
  return { max: safeMax, ratio: clampedValue / safeMax, value: clampedValue };
}

/** Owns determinate progress semantics and animates only updates to the same visual mark. */
export function ProgressBar({
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  className,
  max,
  value,
}: ProgressBarProps) {
  const reduceMotion = useReducedMotionConfig();
  const progress = normalizedProgress(value, max);

  return (
    <BaseProgress.Root
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]", className)}
      max={progress.max}
      value={progress.value}
    >
      <m.div
        animate={{ scaleX: progress.ratio }}
        className="h-full w-full origin-left bg-[var(--color-action)]"
        data-progress-indicator=""
        initial={false}
        transition={reduceMotion ? instantMotionTransition : politeMotionTransition}
      />
    </BaseProgress.Root>
  );
}
