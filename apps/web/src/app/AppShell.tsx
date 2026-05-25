import { LoaderCircle } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { FocusEvent, MouseEvent, PointerEvent } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { preloadRouteForPath } from "@/app/routeModules";
import { useAuth } from "@/shared/auth/useAuth";
import { RouteErrorBoundary } from "@/shared/ui/feedback/RouteErrorBoundary";
import { RouteSuspenseFallback } from "@/shared/ui/feedback/RouteSuspenseFallback";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";

type RouteNavigationIntent = {
  label: string;
  path: string;
};

function routeNavigationIntentFromAnchor(anchor: HTMLAnchorElement): RouteNavigationIntent | null {
  if (anchor.target === "_blank" || anchor.hasAttribute("download")) {
    return null;
  }

  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin) {
    return null;
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath === currentPath) {
    return null;
  }

  const label = anchor.textContent?.trim() || "画面";
  return { label, path: nextPath };
}

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const routeResetKey = `${location.pathname}${location.search}${location.hash}`;
  const [routeNavigationIntent, setRouteNavigationIntent] = useState<RouteNavigationIntent | null>(
    null,
  );

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
    const intent = routeNavigationIntentFromAnchor(anchor);
    if (!intent) {
      return;
    }
    preloadRouteForPath(anchor.pathname);
    setRouteNavigationIntent(intent);
  }, []);

  useEffect(() => {
    setRouteNavigationIntent(null);
  }, [location.key]);

  useEffect(() => {
    if (!routeNavigationIntent) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setRouteNavigationIntent((current) =>
        current?.path === routeNavigationIntent.path ? null : current,
      );
    }, 6_000);
    return () => window.clearTimeout(timeoutId);
  }, [routeNavigationIntent]);

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
          <Suspense fallback={<RouteSuspenseFallback />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>
      {routeNavigationIntent ? (
        <div
          aria-live="polite"
          className="momo-safe-right momo-safe-top pointer-events-none fixed z-[var(--z-toast)] inline-flex items-center gap-2 rounded-full border border-[var(--color-action)]/30 bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-raised)]"
          role="status"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin text-[var(--color-action)] motion-reduce:animate-none"
          />
          <span>{routeNavigationIntent.label}へ移動中…</span>
        </div>
      ) : null}
      <ToastHost />
    </>
  );
}
