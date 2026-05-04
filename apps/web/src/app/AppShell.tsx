import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/shared/auth/useAuth";
import { DialogHost } from "@/shared/ui/feedback/DialogHost";
import { RouteErrorBoundary } from "@/shared/ui/feedback/RouteErrorBoundary";
import { RouteSuspenseFallback } from "@/shared/ui/feedback/RouteSuspenseFallback";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();

  return (
    <DialogHost>
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)] focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        メインコンテンツへスキップ
      </a>
      <GlobalNav
        authDisplayName={auth.auth?.displayName}
        isAuthenticated={auth.isAuthenticated}
        isLogoutPending={auth.isLogoutPending}
        onLogout={auth.logout}
      />
      <main
        className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-[75rem] flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6"
        id="main-content"
      >
        <RouteErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<RouteSuspenseFallback />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>
      <ToastHost />
    </DialogHost>
  );
}
