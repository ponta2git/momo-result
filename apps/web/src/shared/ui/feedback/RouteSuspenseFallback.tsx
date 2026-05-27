import { Skeleton } from "@/shared/ui/feedback/Skeleton";

type RouteSuspenseFallbackProps = {
  asMain?: boolean;
  pathname?: string | undefined;
};

/**
 * ルート単位の Suspense fallback。遷移先の画面骨格に近い skeleton を表示する。
 * `<Suspense fallback={<RouteSuspenseFallback />}>` で利用する。
 */
export function RouteSuspenseFallback({ asMain = false, pathname }: RouteSuspenseFallbackProps) {
  const className = "mx-auto flex w-full max-w-[75rem] flex-col gap-5 px-4 py-8";
  const content = <RouteSkeleton pathname={pathname} />;

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

function RouteSkeleton({ pathname = "" }: { pathname?: string | undefined }) {
  const kind = routeSkeletonKind(pathname);

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

function routeSkeletonKind(
  pathname: string,
): "detail" | "export" | "generic" | "list" | "masters" | "workspace" {
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
