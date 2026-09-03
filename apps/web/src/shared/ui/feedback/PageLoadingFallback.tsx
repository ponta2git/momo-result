import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import {
  pageFrameSiblingGapClass,
  pageFrameWidthClass,
  pageViewportGutterClass,
} from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export type PageLoadingKind =
  | "catalog"
  | "comparison"
  | "detail"
  | "form"
  | "generic"
  | "list"
  | "record-list"
  | "sectioned-comparison"
  | "workspace";

export type PageLoadingHeaderShape = {
  actionSize?: "sm" | "md" | undefined;
  actionSlots?: 0 | 1 | 2 | 3 | undefined;
  description?: boolean | undefined;
  eyebrow?: boolean | undefined;
};

export type PageLoadingFallbackProps = {
  asMain?: boolean | undefined;
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
  contextNoticeSlot = false,
  header,
  kind = "generic",
  leadingActionSlot = false,
  loadingLabel = "読み込んでいます…",
  width = "standard",
}: PageLoadingFallbackProps) {
  const className = cn(
    "mx-auto flex w-full max-w-full min-w-0 flex-col",
    pageFrameSiblingGapClass,
    pageFrameWidthClass[width],
    asMain ? `${pageViewportGutterClass} py-4 sm:py-6` : "",
  );
  const content = (
    <PageLoadingSkeleton
      contextNoticeSlot={contextNoticeSlot}
      header={header}
      kind={kind}
      leadingActionSlot={leadingActionSlot}
      loadingLabel={loadingLabel}
    />
  );

  if (asMain) {
    return (
      <main
        aria-busy="true"
        aria-label={loadingLabel}
        aria-live="polite"
        className={className}
        data-testid="page-loading-fallback"
        id="main-content"
      >
        {content}
      </main>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-label={loadingLabel}
      aria-live="polite"
      className={className}
      data-testid="page-loading-fallback"
    >
      {content}
    </div>
  );
}

function PageLoadingSkeleton({
  contextNoticeSlot,
  header,
  kind,
  leadingActionSlot,
  loadingLabel,
}: {
  contextNoticeSlot: boolean;
  header: PageLoadingHeaderShape | undefined;
  kind: PageLoadingKind;
  leadingActionSlot: boolean;
  loadingLabel: string;
}) {
  const headerSkeleton = <HeaderSkeleton shape={header} />;
  const leadingSkeleton = leadingActionSlot ? <LeadingActionSkeleton /> : null;
  const contextSkeleton = contextNoticeSlot ? <Skeleton className="min-h-28 rounded-md" /> : null;

  if (kind === "list" || kind === "record-list") {
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className={kind === "list" ? "grid gap-6" : "grid gap-4"}>
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-44 rounded-md" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-24 rounded-md" />
            <Skeleton className="h-24 rounded-md" />
            <Skeleton className="h-24 rounded-md" />
          </div>
          <Skeleton className="h-80 rounded-md" />
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
        <PageContentSurface className="grid gap-6">
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
        <PageContentSurface className="grid gap-8">
          <Skeleton className="h-44 rounded-md" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-52 rounded-md" />
            <Skeleton className="h-52 rounded-md" />
          </div>
          <Skeleton className="h-72 rounded-md" />
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "comparison" || kind === "sectioned-comparison") {
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface
          className={kind === "sectioned-comparison" ? "grid gap-6" : "grid gap-4"}
        >
          <Skeleton className="h-28 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-24 rounded-md" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-md" />
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "catalog") {
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-6">
          <Skeleton className="h-14 rounded-md" />
          <div className="grid gap-4 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-[28rem] rounded-md" />
            ))}
          </div>
        </PageContentSurface>
        <LoadingLabel label={loadingLabel} />
      </>
    );
  }

  if (kind === "form") {
    return (
      <>
        {leadingSkeleton}
        {headerSkeleton}
        {contextSkeleton}
        <PageContentSurface className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full max-w-64" />
          <div className="grid gap-4">
            <Skeleton className="h-5 w-full max-w-md" />
            <Skeleton className="h-11 w-full max-w-72" />
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
      <PageContentSurface className="grid gap-4">
        <Skeleton className="h-40 w-full rounded-md" />
        <Skeleton className="h-32 w-full rounded-md" />
      </PageContentSurface>
      <LoadingLabel label={loadingLabel} />
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
  const { actionSize = "md", actionSlots = 0, description = true, eyebrow = true } = shape ?? {};
  const actionHeight = actionSize === "sm" ? "pointer-fine:h-9" : "pointer-fine:h-10";

  return (
    <div aria-hidden="true">
      <PageHeader
        actions={
          actionSlots > 0
            ? Array.from({ length: actionSlots }, (_, index) => (
                <Skeleton
                  className={cn("h-11 rounded-sm", actionHeight, index % 2 === 0 ? "w-28" : "w-36")}
                  key={index}
                />
              ))
            : undefined
        }
        description={
          description ? <Skeleton as="span" className="block h-4 w-full max-w-2xl" /> : undefined
        }
        eyebrow={eyebrow ? <Skeleton as="span" className="block h-4 w-24" /> : undefined}
        title={<Skeleton as="span" className="block h-8 w-full max-w-80 md:h-9" />}
      />
    </div>
  );
}

function LoadingLabel({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>;
}
