import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { m } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { politeMotionTransition } from "@/shared/ui/motion/transitions";

type DisclosureTriggerVariant = "anchor" | "default" | "supporting";
type DisclosurePresentation = "framed" | "inset" | "plain";

const triggerVariantClass = {
  anchor: "",
  default: "",
  supporting: "font-medium text-[var(--color-text-secondary)]",
} as const satisfies Record<DisclosureTriggerVariant, string>;

const presentationClass = {
  framed: {
    panel: "border-t border-[var(--color-border)]",
    root: "rounded-[var(--radius-md)] border border-[var(--color-border)]",
    trigger: "rounded-none",
  },
  inset: {
    panel: "",
    root: "",
    trigger: "",
  },
  plain: {
    panel: "",
    root: "",
    trigger: "",
  },
} as const satisfies Record<
  DisclosurePresentation,
  { panel: string; root: string; trigger: string }
>;

type DisclosureProps = {
  ariaLabel?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  defaultOpen?: boolean | undefined;
  disabled?: boolean | undefined;
  keepMounted?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  panelClassName?: string | undefined;
  presentation?: DisclosurePresentation | undefined;
  summary: ReactNode;
  summaryClassName?: string | undefined;
  triggerClassName?: string | undefined;
  triggerVariant?: DisclosureTriggerVariant | undefined;
};

export function Disclosure({
  ariaLabel,
  children,
  className,
  defaultOpen,
  disabled = false,
  keepMounted = false,
  onOpenChange,
  open,
  panelClassName,
  presentation = "plain",
  summary,
  summaryClassName,
  triggerClassName,
  triggerVariant = "default",
}: DisclosureProps) {
  return (
    <BaseCollapsible.Root
      aria-label={ariaLabel}
      className={cn(presentationClass[presentation].root, className)}
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
    >
      <BaseCollapsible.Trigger
        aria-label={ariaLabel}
        className={cn(
          "group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent",
          triggerVariantClass[triggerVariant],
          presentationClass[presentation].trigger,
          triggerClassName,
        )}
        disabled={disabled}
        render={(triggerProps, state) => (
          <button {...triggerProps} type="button">
            <span className={cn("min-w-0 flex-1", summaryClassName)}>{summary}</span>
            <m.span
              aria-hidden="true"
              animate={{ rotate: state.open ? 180 : 0 }}
              className="inline-flex size-4 shrink-0 text-[var(--color-text-secondary)]"
              initial={false}
              transition={politeMotionTransition}
            >
              <ChevronDown className="size-4" />
            </m.span>
          </button>
        )}
      />
      <BaseCollapsible.Panel
        className={cn(presentationClass[presentation].panel, panelClassName, "bg-transparent")}
        keepMounted={keepMounted}
      >
        {children}
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
