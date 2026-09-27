import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { m } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { politeMotionTransition } from "@/shared/ui/motion/transitions";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";

type DisclosureTriggerVariant = "compact" | "default" | "supporting";
type DisclosurePresentation = "framed" | "plain";
type DisclosurePanelSpacing = "none" | "sm" | "md";
type DisclosurePanelPadding = "none" | "xs" | "sm" | "md";
type DisclosureTriggerLayout = "compact" | "default" | "flush" | "flush-horizontal" | "section";

const triggerVariantClass = {
  compact: "text-xs font-plain text-[var(--color-text-secondary)]",
  default: "text-sm font-plain text-[var(--color-text-primary)]",
  supporting: "text-sm font-plain text-[var(--color-text-secondary)]",
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
    root: "rounded-sm border border-[var(--color-border)]",
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
  const surfaceRef = useSurfaceFeedback<HTMLElement>();
  return (
    <BaseCollapsible.Root
      className={cn("min-w-0", presentationClass[presentation].root)}
      defaultOpen={defaultOpen}
      disabled={disabled}
      open={open}
      onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
    >
      <BaseCollapsible.Trigger
        ref={surfaceRef}
        aria-label={ariaLabel}
        className={cn(
          "momo-surface momo-surface-press group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 text-left data-disabled:cursor-default data-disabled:opacity-70",
          triggerVariantClass[triggerVariant],
          triggerLayoutClass[triggerLayout],
          presentation === "framed" || triggerLayout === "section" ? "rounded-none" : "rounded-sm",
        )}
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
          // Panel presence may outlive open for a commit. Only the chevron animates here:
          // closing content must leave layout before a sibling receives focus.
          "min-w-0 bg-transparent data-closed:hidden",
        )}
        keepMounted={keepMounted}
      >
        {children}
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
