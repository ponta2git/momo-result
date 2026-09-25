import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { m, useReducedMotionConfig } from "motion/react";
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef, ComponentPropsWithRef, Ref } from "react";

import { cn } from "@/shared/ui/cn";
import { instantMotionTransition, politeMotionTransition } from "@/shared/ui/motion/transitions";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";

export type TabsVariant = "filled" | "underline";

type BaseTabsListProps = ComponentPropsWithoutRef<typeof BaseTabs.List>;
type BaseTabsTabProps = ComponentPropsWithoutRef<typeof BaseTabs.Tab>;
type BaseTabsRootProps = ComponentPropsWithRef<typeof BaseTabs.Root>;
type BaseTabsPanelProps = ComponentPropsWithRef<typeof BaseTabs.Panel>;

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
  "aria-label" | "aria-labelledby" | "className" | "style"
> &
  TabsListAccessibleName & {
    ref?: Ref<HTMLDivElement> | undefined;
  } & (
    | { variant?: "filled" | undefined; wrap?: boolean | undefined }
    | { variant: "underline"; wrap?: false | undefined }
  );

export type TabsTabProps = Omit<BaseTabsTabProps, "className" | "style"> & {
  ref?: Ref<HTMLElement> | undefined;
};

const TabsVariantContext = createContext<TabsVariant>("filled");

/** The shared presentations are horizontal; vertical tabs require their own layout contract. */
export function TabsRoot(props: Omit<BaseTabsRootProps, "className" | "orientation" | "style">) {
  return <BaseTabs.Root {...props} orientation="horizontal" />;
}

export function TabsPanel(props: Omit<BaseTabsPanelProps, "className" | "style">) {
  return <BaseTabs.Panel {...props} />;
}

function UnderlineSelectionIndicator() {
  const reduceMotion = useReducedMotionConfig();

  return (
    <BaseTabs.Indicator
      className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5"
      render={(props, state) => {
        const target =
          state.activeTabPosition && state.activeTabSize
            ? { width: state.activeTabSize.width, x: state.activeTabPosition.left }
            : undefined;
        return (
          <span {...props}>
            <m.span
              {...(target ? { animate: target } : {})}
              aria-hidden="true"
              className="absolute top-0 left-0 h-full bg-[var(--color-action)]"
              initial={false}
              style={{
                width: "var(--active-tab-width, 0px)",
                x: "var(--active-tab-left, 0px)",
              }}
              transition={reduceMotion ? instantMotionTransition : politeMotionTransition}
            />
          </span>
        );
      }}
    />
  );
}

/**
 * Owns the shared visual grammar for a related set of views. Feature code still
 * supplies the accessible name and decides whether arrow-key focus activates a tab.
 */
export function TabsList({ children, ref, variant = "filled", wrap, ...props }: TabsListProps) {
  const shouldWrap = wrap ?? variant === "filled";

  return (
    <TabsVariantContext.Provider value={variant}>
      <BaseTabs.List
        {...props}
        ref={ref}
        className={cn(
          "relative flex max-w-full min-w-0",
          shouldWrap ? "flex-wrap" : "flex-nowrap overflow-x-auto overflow-y-hidden",
          variant === "filled"
            ? "gap-2"
            : "border-b border-[var(--color-border)] [scrollbar-width:thin]",
        )}
      >
        {children}
        {variant === "underline" ? <UnderlineSelectionIndicator /> : null}
      </BaseTabs.List>
    </TabsVariantContext.Provider>
  );
}

/** A tab with selection, focus, disabled, and mobile hit-target styling in one place. */
export function TabsTab({ ref, ...props }: TabsTabProps) {
  const variant = useContext(TabsVariantContext);
  const surfaceRef = useSurfaceFeedback(ref);

  return (
    <BaseTabs.Tab
      {...props}
      ref={surfaceRef}
      className={(state) =>
        cn(
          "momo-surface momo-surface-press inline-flex min-h-11 shrink-0 items-center justify-center px-3 py-2 text-sm font-plain whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[var(--color-action)] pointer-fine:min-h-9 pointer-fine:py-1",
          variant === "filled"
            ? cn(
                "rounded-sm focus-visible:outline-offset-2",
                state.active
                  ? "momo-surface-selected text-[var(--color-text-primary)]"
                  : cn(
                      "text-[var(--color-text-secondary)]",
                      state.disabled ? "" : "hover:text-[var(--color-text-primary)]",
                    ),
              )
            : cn(
                "momo-surface-underline -mb-px border-b-2 focus-visible:outline-offset-[-2px]",
                state.active
                  ? "momo-surface-underline-selected border-transparent text-[var(--color-text-primary)]"
                  : cn(
                      "text-[var(--color-text-secondary)]",
                      state.disabled ? "" : "hover:text-[var(--color-text-primary)]",
                    ),
              ),
          state.disabled ? "cursor-not-allowed opacity-60" : "",
        )
      }
    />
  );
}
