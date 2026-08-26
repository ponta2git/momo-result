import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { Suspense, useCallback, useLayoutEffect, useState } from "react";
import type { FocusEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { preloadRouteForPath } from "@/app/routeModules";
import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";
import { useAuth } from "@/shared/auth/useAuth";
import { RouteErrorBoundary } from "@/shared/ui/feedback/RouteErrorBoundary";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import { MotionProvider } from "@/shared/ui/motion/MotionProvider";

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
  const auth = useAuth();
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
    <MotionProvider>
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
          isAccountLocked={auth.isAccountLocked}
          isAuthenticated={auth.isAuthenticated}
          isAdmin={auth.auth?.isAdmin ?? false}
          isLogoutPending={auth.isLogoutPending}
          logoutFailed={Boolean(auth.logoutError)}
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
    </MotionProvider>
  );
}
