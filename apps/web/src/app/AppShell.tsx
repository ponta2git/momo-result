import { Suspense, useCallback } from "react";
import type { FocusEvent, MouseEvent, PointerEvent } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { preloadRouteForPath } from "@/app/routeModules";
import { useAuth } from "@/shared/auth/useAuth";
import { RouteErrorBoundary } from "@/shared/ui/feedback/RouteErrorBoundary";
import { RouteSuspenseFallback } from "@/shared/ui/feedback/RouteSuspenseFallback";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";

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

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const routeResetKey = `${location.pathname}${location.search}${location.hash}`;

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
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)] focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        メインコンテンツへスキップ
      </a>
      <div
        onClickCapture={handleNavigationClick}
        onFocusCapture={handlePreloadIntent}
        onPointerOverCapture={handlePreloadIntent}
      >
        <GlobalNav
          authDisplayName={auth.auth?.displayName}
          isAuthenticated={auth.isAuthenticated}
          isAdmin={auth.auth?.isAdmin ?? false}
          isLogoutPending={auth.isLogoutPending}
          onLogout={auth.logout}
        />
      </div>
      <main
        className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full flex-col px-3 py-4 sm:px-4 sm:py-6"
        id="main-content"
        onClickCapture={handleNavigationClick}
        onFocusCapture={handlePreloadIntent}
        onPointerOverCapture={handlePreloadIntent}
      >
        <RouteErrorBoundary resetKey={routeResetKey}>
          <Suspense fallback={<RouteSuspenseFallback pathname={location.pathname} />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>
      <ToastHost />
    </>
  );
}
