import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type TooltipProps = {
  children: ReactElement;
  className?: string;
  content: ReactNode;
  delay?: number;
  side?: "top" | "right" | "bottom" | "left";
};

export function Tooltip({ children, className, content, delay = 250, side = "top" }: TooltipProps) {
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger delay={delay} render={children} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner className="z-[var(--z-tooltip)]" side={side} sideOffset={8}>
            <BaseTooltip.Popup
              className={cn(
                "max-w-[22rem] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--momo-night-900)] px-3 py-2 text-xs leading-5 text-white shadow-[var(--shadow-raised)]",
                className,
              )}
            >
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
