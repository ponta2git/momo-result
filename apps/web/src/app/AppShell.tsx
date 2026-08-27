import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { Suspense, useCallback, useLayoutEffect, useState } from "react";
import type { FocusEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AppGlobalNav } from "@/app/AppGlobalNav";
import { RouteErrorBoundary } from "@/app/RouteErrorBoundary";
import { preloadRouteForPath } from "@/app/routeModules";
import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";
import { cn } from "@/shared/ui/cn";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { pageViewportGutterClass } from "@/shared/ui/layout/PageFrame";
import { SkipLink } from "@/shared/ui/layout/SkipLink";

function shouldPreloadAnchor(anchor: HTMLAnchorElement): boolean {
  if (anchor.target === "_blank" || anchor.hasAttribute("download")) {
    return false;
  }

  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin) {
    return false;
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath === currentPath) {
    return false;
  }

  return true;
}

function RouteQueryResetBridge({
  children,
  pathname,
  reset,
  resetKey,
}: {
  children: ReactNode;
  pathname: string;
  reset: () => void;
  resetKey: string;
}) {
  const [readyKey, setReadyKey] = useState(resetKey);

  useLayoutEffect(() => {
    if (readyKey === resetKey) {
      return;
    }
    reset();
    setReadyKey(resetKey);
  }, [readyKey, reset, resetKey]);

  if (readyKey !== resetKey) {
    return <RouteSuspenseFallback pathname={pathname} />;
  }

  return children;
}

export function AppShell() {
  const location = useLocation();
  const routeResetKey = location.pathname;

  const handlePreloadIntent = useCallback(
    (event: FocusEvent<HTMLElement> | PointerEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) {
        return;
      }
      preloadRouteForPath(anchor.pathname);
    },
    [],
  );
  const handleNavigationClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) {
      return;
    }
    if (!shouldPreloadAnchor(anchor)) {
      return;
    }
    preloadRouteForPath(anchor.pathname);
  }, []);

  return (
    <>
      <SkipLink />
      <div
        onClickCapture={handleNavigationClick}
        onFocusCapture={handlePreloadIntent}
        onPointerOverCapture={handlePreloadIntent}
      >
        <AppGlobalNav />
      </div>
      <main
        className={cn(
          "mx-auto flex min-h-[calc(100dvh-4rem)] w-full flex-col py-4 sm:py-6",
          pageViewportGutterClass,
        )}
        id="main-content"
        onClickCapture={handleNavigationClick}
        onFocusCapture={handlePreloadIntent}
        onPointerOverCapture={handlePreloadIntent}
      >
        <QueryErrorResetBoundary>
          {({ reset }) => (
            <RouteQueryResetBridge
              pathname={location.pathname}
              reset={reset}
              resetKey={routeResetKey}
            >
              <RouteErrorBoundary onReset={reset} resetKey={routeResetKey}>
                <Suspense fallback={<RouteSuspenseFallback pathname={location.pathname} />}>
                  {/* Route availability must not depend on an exit-animation lifecycle. */}
                  <div className="grid min-w-0">
                    <Outlet />
                  </div>
                </Suspense>
              </RouteErrorBoundary>
            </RouteQueryResetBridge>
          )}
        </QueryErrorResetBoundary>
      </main>
      <ToastHost />
    </>
  );
}
