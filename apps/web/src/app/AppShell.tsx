import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { Suspense, useCallback, useLayoutEffect, useState } from "react";
import type { FocusEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AppGlobalNav } from "@/app/AppGlobalNav";
import { AppPageCanvas } from "@/app/AppPageCanvas";
import { RouteErrorBoundary } from "@/app/RouteErrorBoundary";
import { preloadRouteForPath } from "@/app/routeModules";
import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";
import { useAuthStatus } from "@/shared/auth/useAuthStatus";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";

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
  search,
}: {
  children: ReactNode;
  pathname: string;
  reset: () => void;
  resetKey: string;
  search: string;
}) {
  const [readyKey, setReadyKey] = useState(resetKey);

  useLayoutEffect(() => {
    if (readyKey === resetKey) {
      return;
    }
    reset();
    // The new route may render only after the external QueryErrorResetBoundary was reset.
    // oxlint-disable-next-line react/set-state-in-effect
    setReadyKey(resetKey);
  }, [readyKey, reset, resetKey]);

  if (readyKey !== resetKey) {
    return <RouteSuspenseFallback pathname={pathname} search={search} />;
  }

  return children;
}

export function AppShell() {
  const auth = useAuthStatus();
  const location = useLocation();
  const routeResetKey = location.pathname;

  const handlePreloadIntent = useCallback(
    (event: FocusEvent<HTMLElement> | PointerEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || !shouldPreloadAnchor(anchor)) {
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
      <AppPageCanvas
        navigation={<AppGlobalNav />}
        onClickCapture={handleNavigationClick}
        onFocusCapture={handlePreloadIntent}
        onPointerOverCapture={handlePreloadIntent}
      >
        {auth.error && !location.pathname.startsWith("/admin/") ? (
          <div className="mb-6">
            <Notice
              action={
                <Button
                  pending={auth.isRefetching}
                  pendingLabel="再試行中…"
                  onClick={() => void auth.refetch()}
                >
                  ログイン状態を再確認
                </Button>
              }
              title="ログイン状態を確認できません"
              tone="warning"
            >
              入力内容を保持しています。通信状態を確認して、ログイン状態を再確認してください。
            </Notice>
          </div>
        ) : null}
        <QueryErrorResetBoundary key={auth.auth?.accountId ?? "anonymous"}>
          {({ reset }) => (
            <RouteQueryResetBridge
              pathname={location.pathname}
              reset={reset}
              resetKey={routeResetKey}
              search={location.search}
            >
              <RouteErrorBoundary
                onReset={reset}
                pathname={location.pathname}
                search={location.search}
              >
                <Suspense
                  fallback={
                    <RouteSuspenseFallback pathname={location.pathname} search={location.search} />
                  }
                >
                  {/* Route availability must not depend on an exit-animation lifecycle. */}
                  <div className="grid min-w-0">
                    <Outlet />
                  </div>
                </Suspense>
              </RouteErrorBoundary>
            </RouteQueryResetBridge>
          )}
        </QueryErrorResetBoundary>
      </AppPageCanvas>
      <ToastHost key={auth.auth?.accountId ?? "anonymous"} />
    </>
  );
}
