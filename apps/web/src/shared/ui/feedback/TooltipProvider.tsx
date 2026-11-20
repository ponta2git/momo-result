import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { createContext } from "react";
import type { ReactNode } from "react";

export const tooltipOpenDelayMs = 250;
export const SharedTooltipProviderContext = createContext(false);

/** Owns the app-wide delay group while keeping Tooltip independently renderable. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <SharedTooltipProviderContext value>
      <BaseTooltip.Provider closeDelay={0} delay={tooltipOpenDelayMs} timeout={400}>
        {children}
      </BaseTooltip.Provider>
    </SharedTooltipProviderContext>
  );
}
