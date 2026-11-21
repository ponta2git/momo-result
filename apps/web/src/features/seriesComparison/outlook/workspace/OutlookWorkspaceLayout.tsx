import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

/**
 * The outlook's arrangement, shared by the ready screen and its loading skeleton. These parts
 * only place their slots: they read no store, calculation, or measurement.
 */
const columnsClass = "lg:grid-cols-[minmax(18rem,21rem)_minmax(0,1fr)]";

/** The comparison row stays outside the per-comparison remount, so its controls keep focus. */
export function OutlookWorkspaceFrame({
  comparison,
  children,
}: {
  comparison: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {comparison}
      {children}
    </div>
  );
}

export function OutlookComparisonLayout({
  people,
  standing,
}: {
  people: ReactNode;
  standing: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 grid-cols-1 items-end gap-x-10 gap-y-4", columnsClass)}>
      {people}
      {standing}
    </div>
  );
}

/**
 * The assumptions on the left and the two questions on the right. Where the questions cannot sit
 * side by side, a strip keeps both answers in view: across the page on narrow screens, and at
 * the top of the answers column below the extra-wide breakpoint.
 */
export function OutlookBodyLayout({
  notice,
  strip,
  assumptions,
  assumptionsSticky,
  trend,
  goal,
  details,
}: {
  notice?: ReactNode;
  strip: (placement: "page" | "column") => ReactNode;
  assumptions: ReactNode;
  assumptionsSticky?: boolean;
  trend: ReactNode;
  goal: ReactNode;
  details: ReactNode;
}) {
  return (
    <>
      {notice}
      {strip("page")}
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-x-10 gap-y-8 lg:items-start lg:gap-y-10",
          // A control scrolled into view by focus stops below the navigation and the answer strip.
          "[&_*]:scroll-mt-[calc(var(--global-nav-height)+6rem)] xl:[&_*]:scroll-mt-(--sticky-below-nav)",
          columnsClass,
        )}
      >
        <div
          className={cn(
            "grid min-w-0 content-start",
            assumptionsSticky && "lg:sticky lg:top-(--sticky-below-nav)",
          )}
        >
          {assumptions}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-x-8 gap-y-10 xl:grid-cols-2">
          {strip("column")}
          {trend}
          {goal}
          <div className="xl:col-span-2">{details}</div>
        </div>
      </div>
    </>
  );
}

/**
 * Both questions use one shape: question, answer, support, graph, notes. Side by side, the five
 * rows are shared, so the two questions, answers, and graphs each line up. Rows whose text varies
 * while editing keep the height of their longest form.
 */
export function OutlookQuestion({
  labelledBy,
  question,
  answer,
  support,
  chart,
  notes,
}: {
  labelledBy: string;
  question: ReactNode;
  answer: ReactNode;
  support: ReactNode;
  chart: ReactNode;
  notes: ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="grid min-w-0 content-start gap-y-1 xl:row-span-5 xl:grid-rows-subgrid"
    >
      <div className="flex min-h-10 min-w-0 items-center">{question}</div>
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{answer}</div>
      <div className="grid min-h-8 min-w-0 content-start gap-1">{support}</div>
      <div className="mt-3 min-w-0">{chart}</div>
      <div className="mt-1 grid min-w-0 content-start gap-2">{notes}</div>
    </section>
  );
}
