import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { m } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { politeMotionTransition } from "@/shared/ui/motion/transitions";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";

type DisclosureTriggerVariant = "default" | "supporting";
type DisclosurePresentation = "framed" | "plain";
type DisclosurePanelSpacing = "none" | "sm" | "md";
type DisclosurePanelPadding = "none" | "xs" | "sm" | "md";

const triggerVariantClass = {
  default: "text-sm font-plain text-[var(--color-text-primary)]",
  supporting: "text-sm font-plain text-[var(--color-text-secondary)]",
} as const satisfies Record<DisclosureTriggerVariant, string>;

/**
 * The trigger and its panel share one inline inset, so the summary, the chevron, and the
 * revealed content keep the same start and end edges wherever a disclosure is placed.
 */
const disclosureInlineInsetClass = "px-3";

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

/** Block padding only; the inline inset stays owned by the disclosure. */
const panelPaddingClass = {
  none: "",
  xs: "py-2",
  sm: "py-3",
  md: "py-4",
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
  triggerVariant?: DisclosureTriggerVariant | undefined;
};

/**
 * Opens and closes information; it is neither a selection nor an inset. The panel never paints
 * its own background, so only an inner state, notice, or separate control area may be tinted.
 * Every enabled trigger shares one transient hover regardless of its text variant.
 */
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
          "momo-surface momo-surface-press group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 py-2 text-left data-disabled:cursor-default data-disabled:opacity-60 pointer-fine:min-h-10",
          disclosureInlineInsetClass,
          triggerVariantClass[triggerVariant],
          // Inside a framed root the hover surface sits one radius step inside the frame.
          presentation === "framed" ? "rounded-xs data-panel-open:rounded-b-none" : "rounded-sm",
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
          disclosureInlineInsetClass,
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
