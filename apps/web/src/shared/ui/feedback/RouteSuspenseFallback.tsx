import { Skeleton } from "@/shared/ui/feedback/Skeleton";

/**
 * ルート単位の Suspense fallback。本文の代わりに数行の skeleton を表示する。
 * `<Suspense fallback={<RouteSuspenseFallback />}>` で利用する。
 */
export function RouteSuspenseFallback() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8"
      data-testid="route-suspense-fallback"
    >
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <span className="sr-only">読み込み中...</span>
    </div>
  );
}
