import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

type TooltipProps = {
  children: ReactElement;
  content: ReactNode;
  delay?: number;
  side?: "top" | "right" | "bottom" | "left";
};

const tooltipOpenDelayMs = 250;
const tooltipGroupTimeoutMs = 400;
const SharedTooltipProviderContext = createContext(false);

/** Owns the app-wide delay group while keeping Tooltip independently renderable in tests. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <SharedTooltipProviderContext value>
      <BaseTooltip.Provider
        closeDelay={0}
        delay={tooltipOpenDelayMs}
        timeout={tooltipGroupTimeoutMs}
      >
        {children}
      </BaseTooltip.Provider>
    </SharedTooltipProviderContext>
  );
}

/** A supplementary visual label; the trigger remains responsible for its accessible name. */
export function Tooltip({ children, content, delay, side = "top" }: TooltipProps) {
  const hasSharedProvider = useContext(SharedTooltipProviderContext);

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        delay={delay ?? (hasSharedProvider ? undefined : tooltipOpenDelayMs)}
        render={children}
      />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className="z-[var(--z-tooltip)]" side={side} sideOffset={8}>
          <BaseTooltip.Popup className="max-w-[22rem] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface-inverse)] px-3 py-2 text-xs leading-5 text-[var(--color-text-inverse)] shadow-[var(--shadow-raised)]">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
