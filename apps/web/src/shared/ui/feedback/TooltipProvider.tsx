import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactNode } from "react";

export const tooltipOpenDelayMs = 250;

/** Owns the app-wide delay group while keeping Tooltip independently renderable. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider closeDelay={0} delay={tooltipOpenDelayMs} timeout={400}>
      {children}
    </BaseTooltip.Provider>
  );
}
