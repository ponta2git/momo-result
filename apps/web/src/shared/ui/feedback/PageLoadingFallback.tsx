import type { ReactNode } from "react";

import { actionRowClass, inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { controlSkeletonHeightClass } from "@/shared/ui/forms/controlPresentation";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import type { PageContentSurfacePadding } from "@/shared/ui/layout/PageContentSurface";
import {
  pageFrameSiblingGapClass,
  pageFrameWidthClass,
  pageViewportGutterClass,
} from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import type { PageHeaderDescriptionStatus } from "@/shared/ui/layout/PageHeader";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";

export type PageLoadingKind =
  | "capture"
  | "catalog"
  | "comparison"
  | "detail"
  | "field-sections"
  | "form"
  | "generic"
  | "grouped-list"
  | "list"
  | "sectioned-comparison"
  | "workspace";

type PageLoadingActionShape = {
  actionSize?: "sm" | "md" | undefined;
  actionSlots?: 0 | 1 | 2 | undefined;
  actionWidths?: readonly PageLoadingActionWidth[] | undefined;
};

export type PageLoadingHeaderShape = PageLoadingActionShape & {
  description?: boolean | undefined;
  descriptionStatus?: PageHeaderDescriptionStatus | undefined;
  descriptionText?: string | undefined;
};

export type PageLoadingContentToolbarShape = PageLoadingActionShape & {
  actionPlacement?: "leading" | "trailing" | undefined;
  status?: PageHeaderDescriptionStatus | undefined;
};

export type PageLoadingActionWidth = "compact" | "icon" | "long" | "short" | "standard" | "wide";

export type PageLoadingFallbackProps = {
  asMain?: boolean | undefined;
  /** A route-specific structural skeleton that replaces the generic kind inside the frame. */
  content?: ReactNode | undefined;
  contentPadding?: PageContentSurfacePadding | undefined;
  contentToolbar?: PageLoadingContentToolbarShape | undefined;
  contextNoticeSlot?: boolean | undefined;
  header?: PageLoadingHeaderShape | undefined;
  kind?: PageLoadingKind | undefined;
  leadingActionSlot?: boolean | undefined;
  loadingLabel?: string | undefined;
  width?: PageFrameWidth | undefined;
};

/** Renders a route-agnostic structural loading region selected by the app composition. */
export function PageLoadingFallback({
  asMain = false,
  content: customContent,
  contentPadding,
  contentToolbar,
  contextNoticeSlot = false,
  header,
  kind = "generic",
  leadingActionSlot = false,
  loadingLabel = "読み込んでいます…",
  width = "default",
}: PageLoadingFallbackProps) {
  const className = cn(
    "mx-auto flex w-full max-w-full min-w-0 flex-col",
    pageFrameSiblingGapClass,
    pageFrameWidthClass[width],
    asMain ? `${pageViewportGutterClass} py-4 sm:py-6` : "",
  );
  const content = customContent ? (
    <>
      {customContent}
      <LoadingLabel label={loadingLabel} />
    </>
  ) : (
    <PageLoadingSkeleton
      contentPadding={contentPadding ?? "default"}
      contextNoticeSlot={contextNoticeSlot}
      contentToolbar={contentToolbar}
      header={header}
      kind={kind}
      leadingActionSlot={leadingActionSlot}
      loadingLabel={loadingLabel}
    />
  );

  if (asMain) {
    return (
      <main
        aria-label={loadingLabel}
        className={className}
        data-testid="page-loading-fallback"
        id="main-content"
        tabIndex={-1}
      >
        {content}
      </main>
    );
  }

  return (
    <div aria-label={loadingLabel} className={className} data-testid="page-loading-fallback">
      {content}
    </div>
  );
}

function PageLoadingSkeleton({
  contentPadding,
  contentToolbar,
  contextNoticeSlot,
  header,
  kind,
  leadingActionSlot,
  loadingLabel,
}: {
  contentPadding: PageContentSurfacePadding;
  contentToolbar: PageLoadingContentToolbarShape | undefined;
  contextNoticeSlot: boolean;
  header: PageLoadingHeaderShape | undefined;
  kind: PageLoadingKind;
  leadingActionSlot: boolean;
  loadingLabel: string;
}) {
  const headerSkeleton = header ? <HeaderSkeleton shape={header} /> : null;
  const leadingSkeleton = leadingActionSlot ? <LeadingActionSkeleton /> : null;
  const contextSkeleton = contextNoticeSlot ? <Skeleton className="min-h-28 rounded-md" /> : null;
  const toolbarSkeleton = contentToolbar ? <ContentToolbarSkeleton shape={contentToolbar} /> : null;

  if (kind === "list") {
    // Filtered lists: a search-sheet button below lg, the filter bar from lg, then the list
    // toolbar and table. The breakpoint matches the lists' own table/record switch.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          <div
            className={cn(actionRowClass, "justify-between", contentToolbar ? "" : "lg:hidden")}
            data-page-content-actions=""
          >
            <Skeleton className="h-11 w-28 max-w-full rounded-sm lg:hidden pointer-fine:h-9" />
            {contentToolbar ? (
              <div className="ms-auto">
                <ActionSkeletonGroup shape={contentToolbar} />
              </div>
            ) : null}
          </div>
          <div className="hidden gap-4 lg:grid">
            <div className="grid grid-cols-4 items-end gap-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="grid gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className={controlSkeletonHeightClass} />
                </div>
              ))}
            </div>
            <Skeleton className={controlSkeletonHeightClass} />
          </div>
          <div className="grid gap-4">
            <div className="flex min-h-11 items-center justify-between gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="size-11 rounded-sm" />
            </div>
            <ListRowsSkeleton />
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "grouped-list") {
    // A count and actions row, then one group: its heading, note, and table.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          <div className={cn(actionRowClass, "justify-between")} data-page-content-actions="">
            <Skeleton className="h-5 w-40" />
            {contentToolbar ? <ActionSkeletonGroup shape={contentToolbar} /> : null}
          </div>
          <div className="grid gap-2">
            <div className="grid gap-1">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full max-w-80" />
            </div>
            <ListRowsSkeleton rows={3} />
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "workspace") {
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          {toolbarSkeleton}
          <Skeleton className="h-24 rounded-md" />
          <div className="grid gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-20 rounded-md" />
            ))}
          </div>
          <Skeleton className="h-[26rem] rounded-md" />
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "detail") {
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        {/* Detail sections sit 24px apart: record facts, the result ledger, then the rest. */}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          {toolbarSkeleton}
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-160 rounded-md" />
          <Skeleton className="h-28 rounded-md" />
        </PageContentSurface>
        {/* Details always end with the previous / next navigation, even at a known end. */}
        <div aria-hidden="true" className="grid grid-cols-2 gap-2">
          <Skeleton className="h-17.5 rounded-sm" />
          <Skeleton className="h-17.5 rounded-sm" />
        </div>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "comparison") {
    // Comparison scope summary, purpose tabs, then the selected purpose's content.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          {toolbarSkeleton}
          <div className="grid gap-2">
            <Skeleton className="h-14 rounded-sm" />
            <div className="flex min-h-9 items-center justify-between gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-11 w-32 rounded-sm pointer-fine:h-9" />
            </div>
          </div>
          <TabsSkeleton tabs={3} />
          <div className="grid gap-4">
            <Skeleton className="h-5 w-48" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-80 rounded-md" />
              ))}
            </div>
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "sectioned-comparison") {
    // Admin tabs, the title field, then stacked sections.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          {toolbarSkeleton}
          <TabsSkeleton tabs={2} />
          <FieldSkeleton className="max-w-lg" />
          <div className="grid gap-6">
            <Skeleton className="h-10 w-full max-w-md rounded-sm" />
            <SectionSkeleton lines={2} />
            <SectionSkeleton lines={2} />
            <ListRowsSkeleton rows={3} />
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "catalog") {
    // Management tabs, then one panel: its heading, note, and table.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          {toolbarSkeleton}
          <TabsSkeleton tabs={3} />
          <div className="grid gap-4">
            <SectionSkeleton lines={1} />
            <FieldSkeleton className="max-w-md" />
            <ListRowsSkeleton rows={4} />
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "form") {
    // Two choice sections: a heading, its note, and tabs; then a heading, tabs, and a panel.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-4" padding={contentPadding}>
          {toolbarSkeleton}
          <div className="grid gap-2">
            <SectionSkeleton lines={1} />
            <TabsSkeleton tabs={4} />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-5 w-24" />
            <div className="grid gap-4">
              <TabsSkeleton tabs={2} />
              <Skeleton className="h-28 rounded-sm" />
            </div>
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "capture") {
    // Capture destination fields, then the camera frame beside the classification tray.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          {toolbarSkeleton}
          <div className="grid gap-4">
            <SectionSkeleton lines={1} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <FieldSkeleton key={index} />
              ))}
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
            <div className="grid content-start gap-4">
              <SectionSkeleton lines={1} />
              <Skeleton className="aspect-video rounded-md" />
            </div>
            <div className="grid content-start gap-4">
              <SectionSkeleton lines={1} />
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-52 rounded-md" />
              ))}
            </div>
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "field-sections") {
    // A scope field with its actions, then headed sections.
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6" padding={contentPadding}>
          {toolbarSkeleton}
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <FieldSkeleton className="w-full sm:w-80" />
            <Skeleton className="h-11 w-24 rounded-sm pointer-fine:h-10" />
            <Skeleton className="h-11 w-24 rounded-sm pointer-fine:h-10" />
          </div>
          <div className="grid gap-6">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-32" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-14" />
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Skeleton className="h-5 w-32" />
              <ListRowsSkeleton rows={5} />
            </div>
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  return (
    <>
      {leadingSkeleton}
      {headerSkeleton}
      {contextSkeleton}
      <PageContentSurface className="grid gap-4" padding={contentPadding}>
        {toolbarSkeleton}
        <Skeleton className="h-40 w-full rounded-md" />
        <Skeleton className="h-32 w-full rounded-md" />
      </PageContentSurface>
      <LoadingLabel label={loadingLabel} />
    </>
  );
}

/** A labelled control: 14px label, 8px gap, and the shared control height. */
function FieldSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid w-full gap-2", className)}>
      <Skeleton className="h-5 w-20" />
      <Skeleton className={controlSkeletonHeightClass} />
    </div>
  );
}

/** A section heading with its note lines. */
function SectionSkeleton({ lines }: { lines: number }) {
  return (
    <div className="grid gap-1">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-5 w-full max-w-md" />
      ))}
    </div>
  );
}

/** A filled tab list: tabs share the button height and keep their own widths. */
function TabsSkeleton({ tabs }: { tabs: number }) {
  const widths = ["w-24", "w-16", "w-20", "w-14"];
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {Array.from({ length: tabs }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-11 rounded-sm pointer-fine:h-9", widths[index % widths.length])}
        />
      ))}
    </div>
  );
}

/** The ready table from lg (header and row rules, cell inset); compact records below lg. */
function ListRowsSkeleton({ rows = 4 }: { rows?: number }) {
  const ids = Array.from({ length: rows }, (_, index) => index);
  return (
    <>
      <div className="hidden border-y border-[var(--color-border-strong)] lg:block">
        <div className="border-b border-[var(--color-border-strong)] px-3 py-2">
          <Skeleton className="h-4 w-full" />
        </div>
        {ids.map((id) => (
          <div key={id} className="px-3 py-3">
            <Skeleton className="h-11" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border-strong)] lg:hidden">
        {ids.map((id) => (
          <div key={id} className="grid gap-2 py-3">
            <div className="grid gap-1">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-4 w-2/5" />
            </div>
            <Skeleton className="h-11" />
          </div>
        ))}
      </div>
    </>
  );
}

function LeadingActionSkeleton() {
  return (
    <div>
      <Skeleton className="h-11 w-40 max-w-full rounded-sm pointer-fine:h-9" />
    </div>
  );
}

function HeaderSkeleton({ shape }: { shape: PageLoadingHeaderShape | undefined }) {
  const { description = true, descriptionStatus, descriptionText } = shape ?? {};

  return (
    <div aria-hidden="true">
      <PageHeader
        actions={
          (shape?.actionSlots ?? 0) > 0 ? <ActionSkeletonGroup shape={shape ?? {}} /> : undefined
        }
        description={
          description
            ? (descriptionText ?? (
                <Skeleton as="span" className="max-w-readable block h-5 w-full" />
              ))
            : undefined
        }
        descriptionStatus={descriptionStatus}
        title={<Skeleton as="span" className="block h-8 w-full max-w-80 @3xl/page-header:h-9" />}
      />
    </div>
  );
}

function ContentToolbarSkeleton({ shape }: { shape: PageLoadingContentToolbarShape }) {
  return (
    <div
      className={cn(
        actionRowClass,
        shape.status
          ? "justify-between"
          : shape.actionPlacement === "leading"
            ? "justify-start"
            : "justify-end",
      )}
      data-page-content-actions=""
    >
      {shape.status && shape.actionPlacement !== "leading" ? (
        <StatusBadge {...shape.status} />
      ) : null}
      <ActionSkeletonGroup shape={shape} />
      {shape.status && shape.actionPlacement === "leading" ? (
        <div className="ms-auto">
          <StatusBadge {...shape.status} />
        </div>
      ) : null}
    </div>
  );
}

function ActionSkeletonGroup({ shape }: { shape: PageLoadingActionShape }) {
  const { actionSize = "md", actionSlots = 0, actionWidths = [] } = shape;
  if (actionSlots === 0) return null;

  const actionHeight = actionSize === "sm" ? "pointer-fine:h-9" : "pointer-fine:h-10";
  const widthClasses = {
    compact: "w-20",
    icon: "w-11",
    long: "w-32",
    short: "w-16",
    standard: "w-28",
    wide: "w-36",
  } as const;
  const actionSkeletons = Array.from({ length: actionSlots }, (_, index) => {
    const width = actionWidths[index] ?? "standard";
    return (
      <Skeleton
        // Icon-only actions keep their 44px box for every pointer.
        className={cn(
          "h-11 max-w-full rounded-sm",
          width === "icon" ? "" : actionHeight,
          widthClasses[width],
        )}
        key={index}
      />
    );
  });

  return (
    <div aria-hidden="true" className={inlineActionGroupClass}>
      {actionSkeletons}
    </div>
  );
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span className="sr-only" role="status">
      {label}
    </span>
  );
}
