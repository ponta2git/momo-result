import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cloneElement, createContext, useContext, useId } from "react";
import type { ReactElement, ReactNode } from "react";

import { useDialogFloatingContainer } from "@/shared/ui/feedback/DialogFloatingContainer";

type TooltipProps = {
  children: ReactElement<{ "aria-describedby"?: string | undefined }>;
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

/** A supplementary description; the trigger remains responsible for its accessible name. */
export function Tooltip({ children, content, delay, side = "top" }: TooltipProps) {
  const hasSharedProvider = useContext(SharedTooltipProviderContext);
  const floatingContainer = useDialogFloatingContainer();
  const descriptionId = useId();
  const trigger = cloneElement(children, {
    "aria-describedby": [children.props["aria-describedby"], descriptionId]
      .filter(Boolean)
      .join(" "),
  });

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        delay={delay ?? (hasSharedProvider ? undefined : tooltipOpenDelayMs)}
        render={trigger}
      />
      <BaseTooltip.Portal container={floatingContainer ?? undefined}>
        <BaseTooltip.Positioner
          className="pointer-events-auto z-[var(--z-tooltip)]"
          side={side}
          sideOffset={8}
        >
          <BaseTooltip.Popup
            className="max-w-[min(22rem,var(--available-width))] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-inverse)] px-3 py-2 text-xs leading-5 text-[var(--color-text-inverse)] shadow-[var(--shadow-raised)]"
            id={descriptionId}
            role="tooltip"
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
