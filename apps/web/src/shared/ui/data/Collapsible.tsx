import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

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
  summary: ReactNode;
  summaryClassName?: string | undefined;
  triggerClassName?: string | undefined;
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
  summary,
  summaryClassName,
  triggerClassName,
}: DisclosureProps) {
  return (
    <BaseCollapsible.Root
      aria-label={ariaLabel}
      className={className}
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
    >
      <BaseCollapsible.Trigger
        aria-label={ariaLabel}
        className={cn(
          "group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] disabled:cursor-default disabled:opacity-70",
          triggerClassName,
        )}
        disabled={disabled}
      >
        <span className={cn("min-w-0 flex-1", summaryClassName)}>{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-[var(--color-text-secondary)] transition-transform duration-[var(--motion-fast)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
        />
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel className={panelClassName} keepMounted={keepMounted}>
        {children}
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
