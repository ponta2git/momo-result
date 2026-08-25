import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { pageFrameWidthClass } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";

export type PageLoadingKind =
  | "catalog"
  | "comparison"
  | "detail"
  | "generic"
  | "list"
  | "split"
  | "workspace";

export type PageLoadingFallbackProps = {
  asMain?: boolean | undefined;
  kind?: PageLoadingKind | undefined;
  width?: PageFrameWidth | undefined;
};

/** Renders a route-agnostic structural loading region selected by the app composition. */
export function PageLoadingFallback({
  asMain = false,
  kind = "generic",
  width = "standard",
}: PageLoadingFallbackProps) {
  const className = `mx-auto flex w-full ${pageFrameWidthClass[width]} flex-col gap-4 px-4 py-8`;
  const content = <PageLoadingSkeleton kind={kind} />;

  if (asMain) {
    return (
      <main
        aria-busy="true"
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
      aria-live="polite"
      className={className}
      data-testid="page-loading-fallback"
    >
      {content}
    </div>
  );
}

function PageLoadingSkeleton({ kind }: { kind: PageLoadingKind }) {
  if (kind === "list") {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-16 rounded-[var(--radius-md)]" />
        <Skeleton className="h-44 rounded-[var(--radius-md)]" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-24 rounded-[var(--radius-md)]" />
          <Skeleton className="h-24 rounded-[var(--radius-md)]" />
          <Skeleton className="h-24 rounded-[var(--radius-md)]" />
        </div>
        <Skeleton className="h-80 rounded-[var(--radius-md)]" />
        <LoadingLabel />
      </>
    );
  }

  if (kind === "workspace") {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-24 rounded-[var(--radius-md)]" />
        <div className="grid gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-[var(--radius-md)]" />
          ))}
        </div>
        <Skeleton className="h-[26rem] rounded-[var(--radius-md)]" />
        <LoadingLabel />
      </>
    );
  }

  if (kind === "detail") {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-44 rounded-[var(--radius-md)]" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-52 rounded-[var(--radius-md)]" />
          <Skeleton className="h-52 rounded-[var(--radius-md)]" />
        </div>
        <Skeleton className="h-72 rounded-[var(--radius-md)]" />
        <LoadingLabel />
      </>
    );
  }

  if (kind === "comparison") {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-28 rounded-[var(--radius-md)]" />
        <Skeleton className="h-12 rounded-[var(--radius-md)]" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-[var(--radius-md)]" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-[var(--radius-md)]" />
        <span className="sr-only">比較画面を読み込んでいます…</span>
      </>
    );
  }

  if (kind === "catalog") {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-14 rounded-[var(--radius-md)]" />
        <div className="grid gap-4 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-[28rem] rounded-[var(--radius-md)]" />
          ))}
        </div>
        <LoadingLabel />
      </>
    );
  }

  if (kind === "split") {
    return (
      <>
        <HeaderSkeleton />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
          <Skeleton className="h-80 rounded-[var(--radius-md)]" />
          <Skeleton className="h-80 rounded-[var(--radius-md)]" />
        </div>
        <LoadingLabel />
      </>
    );
  }

  return (
    <>
      <HeaderSkeleton />
      <Skeleton className="h-40 w-full rounded-[var(--radius-md)]" />
      <Skeleton className="h-32 w-full rounded-[var(--radius-md)]" />
      <LoadingLabel />
    </>
  );
}

function HeaderSkeleton() {
  return (
    <div className="grid gap-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-full max-w-80" />
      <Skeleton className="h-4 w-full max-w-2xl" />
    </div>
  );
}

function LoadingLabel() {
  return <span className="sr-only">読み込んでいます…</span>;
}
