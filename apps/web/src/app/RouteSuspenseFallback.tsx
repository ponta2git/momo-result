import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";
import type { PageLoadingFallbackProps } from "@/shared/ui/feedback/PageLoadingFallback";

type RouteSuspenseFallbackProps = {
  asMain?: boolean | undefined;
  pathname: string;
};

type RouteLoadingPresentation = Required<Pick<PageLoadingFallbackProps, "kind" | "width">>;

/** Keeps pathname-to-layout knowledge in the app layer rather than shared UI. */
export function routeLoadingPresentation(pathname: string): RouteLoadingPresentation {
  if (pathname === "/matches" || pathname === "/held-events" || pathname === "/admin/accounts") {
    return { kind: "list", width: "standard" };
  }
  if (
    pathname === "/matches/new" ||
    pathname === "/ocr/new" ||
    /^\/review\/[^/]+$/u.test(pathname) ||
    /^\/matches\/[^/]+\/edit$/u.test(pathname)
  ) {
    return { kind: "workspace", width: "workspace" };
  }
  if (/^\/(?:matches|held-events)\/[^/]+$/u.test(pathname)) {
    return { kind: "detail", width: "wide" };
  }
  if (pathname === "/analytics/series" || pathname === "/admin/analysis") {
    return { kind: "comparison", width: "wide" };
  }
  if (pathname === "/admin/masters") {
    return { kind: "catalog", width: "standard" };
  }
  if (pathname === "/exports") {
    return { kind: "split", width: "narrow" };
  }
  return { kind: "generic", width: "standard" };
}

export function RouteSuspenseFallback({ asMain = false, pathname }: RouteSuspenseFallbackProps) {
  const presentation = routeLoadingPresentation(pathname);
  return <PageLoadingFallback asMain={asMain} {...presentation} />;
}
