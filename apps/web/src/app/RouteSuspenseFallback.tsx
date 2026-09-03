import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";
import type { PageLoadingFallbackProps } from "@/shared/ui/feedback/PageLoadingFallback";

type RouteSuspenseFallbackProps = {
  asMain?: boolean | undefined;
  pathname: string;
};

type RouteLoadingPresentation = Required<Pick<PageLoadingFallbackProps, "kind" | "width">> &
  Pick<PageLoadingFallbackProps, "loadingLabel">;

/** Keeps pathname-to-layout knowledge in the app layer rather than shared UI. */
export function routeLoadingPresentation(pathname: string): RouteLoadingPresentation {
  if (pathname === "/matches") {
    return { kind: "list", width: "standard" };
  }
  if (pathname === "/held-events" || pathname === "/admin/accounts") {
    return { kind: "record-list", width: "standard" };
  }
  if (
    pathname === "/matches/new" ||
    /^\/review\/[^/]+$/u.test(pathname) ||
    /^\/matches\/[^/]+\/edit$/u.test(pathname)
  ) {
    return { kind: "workspace", width: "workspace" };
  }
  if (pathname === "/ocr/new") {
    return { kind: "workspace", width: "standard" };
  }
  if (/^\/(?:matches|held-events)\/[^/]+$/u.test(pathname)) {
    return { kind: "detail", width: "wide" };
  }
  if (pathname === "/analytics/series") {
    return { kind: "comparison", loadingLabel: "戦績比較を読み込んでいます", width: "wide" };
  }
  if (pathname === "/admin/analysis") {
    return {
      kind: "sectioned-comparison",
      loadingLabel: "戦績分析管理を読み込んでいます",
      width: "wide",
    };
  }
  if (pathname === "/admin/masters") {
    return { kind: "catalog", loadingLabel: "設定管理を読み込んでいます", width: "standard" };
  }
  if (pathname === "/exports") {
    return { kind: "form", width: "narrow" };
  }
  return { kind: "generic", width: "standard" };
}

export function RouteSuspenseFallback({ asMain = false, pathname }: RouteSuspenseFallbackProps) {
  const presentation = routeLoadingPresentation(pathname);
  return <PageLoadingFallback asMain={asMain} {...presentation} />;
}
