import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { m } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { politeMotionTransition } from "@/shared/ui/motion/transitions";

type DisclosureTriggerVariant = "compact" | "default" | "supporting";
type DisclosurePresentation = "framed" | "inset" | "plain";
type DisclosurePanelSpacing = "none" | "sm" | "md";
type DisclosurePanelPadding = "none" | "xs" | "sm" | "md";
type DisclosureTriggerLayout = "compact" | "default" | "flush" | "flush-horizontal" | "section";

const triggerVariantClass = {
  compact: "text-xs font-semibold text-[var(--color-text-secondary)]",
  default: "text-sm font-semibold text-[var(--color-text-primary)]",
  supporting: "text-sm font-medium text-[var(--color-text-secondary)]",
} as const satisfies Record<DisclosureTriggerVariant, string>;

const triggerLayoutClass = {
  compact: "px-2 py-2",
  default: "px-3 py-2",
  flush: "p-0",
  "flush-horizontal": "px-0 py-2",
  section: "px-4 py-3",
} as const satisfies Record<DisclosureTriggerLayout, string>;

const presentationClass = {
  framed: {
    panel: "border-t border-[var(--color-border)]",
    root: "rounded-[var(--radius-md)] border border-[var(--color-border)]",
  },
  inset: {
    panel: "",
    root: "",
  },
  plain: {
    panel: "",
    root: "",
  },
} as const satisfies Record<DisclosurePresentation, { panel: string; root: string }>;

const panelSpacingClass = {
  none: "",
  sm: "mt-2",
  md: "mt-3",
} as const satisfies Record<DisclosurePanelSpacing, string>;

const panelPaddingClass = {
  none: "",
  xs: "p-2",
  sm: "p-3",
  md: "p-4",
} as const satisfies Record<DisclosurePanelPadding, string>;

type DisclosureProps = {
  ariaLabel?: string | undefined;
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  disabled?: boolean | undefined;
  keepMounted?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  panelPadding?: DisclosurePanelPadding | undefined;
  panelSpacing?: DisclosurePanelSpacing | undefined;
  presentation?: DisclosurePresentation | undefined;
  summary: ReactNode;
  triggerLayout?: DisclosureTriggerLayout | undefined;
  triggerVariant?: DisclosureTriggerVariant | undefined;
};

export function Disclosure({
  ariaLabel,
  children,
  defaultOpen,
  disabled = false,
  keepMounted = false,
  onOpenChange,
  open,
  panelPadding = "none",
  panelSpacing = "none",
  presentation = "plain",
  summary,
  triggerLayout = "default",
  triggerVariant = "default",
}: DisclosureProps) {
  return (
    <BaseCollapsible.Root
      aria-label={ariaLabel}
      className={cn("min-w-0", presentationClass[presentation].root)}
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
    >
      <BaseCollapsible.Trigger
        aria-label={ariaLabel}
        className={cn(
          "group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 text-left hover:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent",
          triggerVariantClass[triggerVariant],
          triggerLayoutClass[triggerLayout],
          presentation === "framed" || triggerLayout === "section"
            ? "rounded-none"
            : "rounded-[var(--radius-sm)]",
        )}
        disabled={disabled}
        render={(triggerProps, state) => (
          <button {...triggerProps} type="button">
            <span className="min-w-0 flex-1">{summary}</span>
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
        className={cn(
          presentationClass[presentation].panel,
          panelSpacingClass[panelSpacing],
          panelPaddingClass[panelPadding],
          "bg-transparent",
        )}
        keepMounted={keepMounted}
      >
        {children}
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
