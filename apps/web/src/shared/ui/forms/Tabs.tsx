import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef, Ref } from "react";

import { cn } from "@/shared/ui/cn";

export type TabsVariant = "filled" | "underline";

type BaseTabsListProps = ComponentPropsWithoutRef<typeof BaseTabs.List>;
type BaseTabsTabProps = ComponentPropsWithoutRef<typeof BaseTabs.Tab>;

type TabsListAccessibleName =
  | {
      "aria-label": string;
      "aria-labelledby"?: string | undefined;
    }
  | {
      "aria-label"?: string | undefined;
      "aria-labelledby": string;
    };

export type TabsListProps = Omit<
  BaseTabsListProps,
  "aria-label" | "aria-labelledby" | "className"
> &
  TabsListAccessibleName & {
    className?: string | undefined;
    ref?: Ref<HTMLDivElement> | undefined;
    variant?: TabsVariant | undefined;
    wrap?: boolean | undefined;
  };

export type TabsTabProps = Omit<BaseTabsTabProps, "className"> & {
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
};

const TabsVariantContext = createContext<TabsVariant>("filled");

export const TabsRoot = BaseTabs.Root;
export const TabsPanel = BaseTabs.Panel;

/**
 * Owns the shared visual grammar for a related set of views. Feature code still
 * supplies the accessible name and decides whether arrow-key focus activates a tab.
 */
export function TabsList({
  children,
  className,
  ref,
  variant = "filled",
  wrap,
  ...props
}: TabsListProps) {
  const shouldWrap = wrap ?? variant === "filled";

  return (
    <TabsVariantContext.Provider value={variant}>
      <BaseTabs.List
        {...props}
        ref={ref}
        className={cn(
          "flex max-w-full min-w-0",
          shouldWrap ? "flex-wrap" : "flex-nowrap overflow-x-auto overflow-y-hidden",
          variant === "filled"
            ? "gap-2"
            : "border-b border-[var(--color-border)] [scrollbar-width:thin]",
          className,
        )}
      >
        {children}
      </BaseTabs.List>
    </TabsVariantContext.Provider>
  );
}

/** A tab with selection, focus, disabled, and mobile hit-target styling in one place. */
export function TabsTab({ className, ref, ...props }: TabsTabProps) {
  const variant = useContext(TabsVariantContext);

  return (
    <BaseTabs.Tab
      {...props}
      ref={ref}
      className={(state) =>
        cn(
          "inline-flex min-h-11 shrink-0 items-center justify-center px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-[var(--color-action)] sm:min-h-9 sm:py-2",
          variant === "filled"
            ? cn(
                "rounded-[var(--radius-sm)] focus-visible:outline-offset-2",
                state.active
                  ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                  : cn(
                      "text-[var(--color-text-secondary)]",
                      state.disabled
                        ? ""
                        : "hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]",
                    ),
              )
            : cn(
                "-mb-px border-b-2 focus-visible:outline-offset-[-2px]",
                state.active
                  ? "border-[var(--color-action)] text-[var(--color-text-primary)]"
                  : cn(
                      "border-transparent text-[var(--color-text-secondary)]",
                      state.disabled
                        ? ""
                        : "hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]",
                    ),
              ),
          state.disabled ? "cursor-not-allowed opacity-60" : "",
          className,
        )
      }
    />
  );
}
