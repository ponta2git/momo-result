import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { pageFrameWidthClass } from "@/shared/ui/layout/PageFrame";

type RouteSuspenseFallbackProps = {
  asMain?: boolean;
  pathname?: string | undefined;
};

/**
 * ルート単位の Suspense fallback。遷移先の画面骨格に近い skeleton を表示する。
 * `<Suspense fallback={<RouteSuspenseFallback />}>` で利用する。
 */
export function RouteSuspenseFallback({ asMain = false, pathname }: RouteSuspenseFallbackProps) {
  const kind = routeSkeletonKind(pathname ?? "");
  const className = `mx-auto flex w-full ${routeSkeletonWidthClass(kind)} flex-col gap-5 px-4 py-8`;
  const content = <RouteSkeleton kind={kind} />;

  if (asMain) {
    return (
      <main
        aria-busy="true"
        aria-live="polite"
        className={className}
        data-testid="route-suspense-fallback"
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
      data-testid="route-suspense-fallback"
    >
      {content}
    </div>
  );
}

function RouteSkeleton({ kind }: { kind: RouteSkeletonKind }) {
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
        <span className="sr-only">読み込んでいます…</span>
      </>
    );
  }

  if (kind === "workspace") {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-24 rounded-[var(--radius-md)]" />
        <div className="grid gap-4 lg:grid-cols-4">
          <Skeleton className="h-20 rounded-[var(--radius-md)]" />
          <Skeleton className="h-20 rounded-[var(--radius-md)]" />
          <Skeleton className="h-20 rounded-[var(--radius-md)]" />
          <Skeleton className="h-20 rounded-[var(--radius-md)]" />
        </div>
        <Skeleton className="h-[26rem] rounded-[var(--radius-md)]" />
        <span className="sr-only">読み込んでいます…</span>
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
        <span className="sr-only">読み込んでいます…</span>
      </>
    );
  }

  if (kind === "masters") {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-14 rounded-[var(--radius-md)]" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-[28rem] rounded-[var(--radius-md)]" />
          <Skeleton className="h-[28rem] rounded-[var(--radius-md)]" />
          <Skeleton className="h-[28rem] rounded-[var(--radius-md)]" />
        </div>
        <span className="sr-only">読み込んでいます…</span>
      </>
    );
  }

  if (kind === "export") {
    return (
      <>
        <HeaderSkeleton />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
          <Skeleton className="h-80 rounded-[var(--radius-md)]" />
          <Skeleton className="h-80 rounded-[var(--radius-md)]" />
        </div>
        <span className="sr-only">読み込んでいます…</span>
      </>
    );
  }

  return (
    <>
      <HeaderSkeleton />
      <Skeleton className="h-40 w-full rounded-[var(--radius-md)]" />
      <Skeleton className="h-32 w-full rounded-[var(--radius-md)]" />
      <span className="sr-only">読み込んでいます…</span>
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

function routeSkeletonKind(pathname: string): RouteSkeletonKind {
  if (pathname === "/matches" || pathname === "/held-events" || pathname === "/admin/accounts") {
    return "list";
  }
  if (
    pathname === "/matches/new" ||
    pathname === "/ocr/new" ||
    /^\/review\/[^/]+$/u.test(pathname) ||
    /^\/matches\/[^/]+\/edit$/u.test(pathname)
  ) {
    return "workspace";
  }
  if (/^\/matches\/[^/]+$/u.test(pathname)) {
    return "detail";
  }
  if (pathname === "/admin/masters") {
    return "masters";
  }
  if (pathname === "/exports") {
    return "export";
  }
  return "generic";
}

type RouteSkeletonKind = "detail" | "export" | "generic" | "list" | "masters" | "workspace";

function routeSkeletonWidthClass(kind: RouteSkeletonKind): string {
  if (kind === "workspace" || kind === "masters") {
    return pageFrameWidthClass.workspace;
  }
  if (kind === "export") {
    return pageFrameWidthClass.wide;
  }
  return pageFrameWidthClass.standard;
}
