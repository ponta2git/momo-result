import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";

import { routeFrameWidth, RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";
import { loginDescription } from "@/shared/auth/loginCopy";
import { loginNavItems } from "@/shared/auth/loginNavigation";
import {
  buildLoginPath,
  currentAppPath,
  sanitizeAppRedirectPath,
} from "@/shared/auth/redirectPath";
import { useAuth } from "@/shared/auth/useAuth";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame, pageViewportGutterClass } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

function StandaloneRouteMain({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <GlobalNav
        brandTo="/login"
        environmentLabel={import.meta.env.DEV ? "DEV" : undefined}
        items={loginNavItems}
      />
      <main
        className={cn("mx-auto flex w-full flex-1 flex-col py-4 sm:py-6", pageViewportGutterClass)}
        id="main-content"
      >
        {children}
      </main>
    </div>
  );
}

function RouteGuardFrame({
  children,
  standalone = false,
  width = "standard",
}: {
  children: ReactNode;
  standalone?: boolean;
  width?: PageFrameWidth;
}) {
  const frame = <PageFrame width={width}>{children}</PageFrame>;

  if (standalone) {
    return <StandaloneRouteMain>{frame}</StandaloneRouteMain>;
  }

  return frame;
}

function LoginAuthLoading() {
  return (
    <RouteGuardFrame standalone width="narrow">
      <div className="mx-auto grid w-full max-w-[34rem] gap-6">
        <PageHeader description={loginDescription} title="ログイン" />
        <PageContentSurface aria-busy="true" aria-label="ログイン状態を確認中">
          <div aria-hidden="true" className="grid gap-4">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-20 w-full" />
          </div>
        </PageContentSurface>
      </div>
    </RouteGuardFrame>
  );
}

function AuthLoading({ message, standalone = false }: { message: string; standalone?: boolean }) {
  return (
    <RouteGuardFrame standalone={standalone}>
      <PageContentSurface aria-busy="true" aria-label="ログイン状態を確認中">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{message}</p>
        <div className="mt-4 grid gap-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-20 w-full" />
        </div>
      </PageContentSurface>
    </RouteGuardFrame>
  );
}

export function RootRedirect() {
  const auth = useAuth();

  if (auth.isChecking) {
    return <AuthLoading message="ログイン状態を確認中…" standalone />;
  }

  if (auth.isForbidden) {
    return <Navigate to="/login?reason=forbidden" replace />;
  }

  if (auth.isAuthenticated) {
    return <Navigate to="/matches" replace />;
  }

  return <Navigate to="/login" replace />;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [searchParams] = useSearchParams();

  if (auth.isChecking) {
    return <LoginAuthLoading />;
  }

  if (auth.isAuthenticated) {
    const destination = sanitizeAppRedirectPath(searchParams.get("next")) ?? "/matches";
    return <Navigate to={destination} replace />;
  }

  return children;
}

export function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isChecking) {
    return (
      <StandaloneRouteMain>
        <RouteSuspenseFallback
          loadingLabel="ログイン状態を確認中…"
          pathname={location.pathname}
          search={location.search}
        />
      </StandaloneRouteMain>
    );
  }

  if (auth.isUnauthorized) {
    const next = currentAppPath(location.pathname, location.search, location.hash);
    return <Navigate to={buildLoginPath(next)} replace />;
  }

  if (auth.isForbidden) {
    const next = currentAppPath(location.pathname, location.search, location.hash);
    return <Navigate to={buildLoginPath(next, "forbidden")} replace />;
  }

  if (auth.error) {
    return (
      <RouteGuardFrame standalone width={routeFrameWidth(location.pathname)}>
        <PageHeader title="ログイン状態を確認できません" />
        <PageContentSurface>
          <Notice
            action={
              <Button
                pending={auth.isRefetching}
                pendingLabel="再試行中…"
                onClick={() => void auth.refetch()}
              >
                再試行
              </Button>
            }
            tone="danger"
          >
            ログイン状態を確認できないため、この画面の表示を一時停止しています。通信状態を確認して、再試行してください。
          </Notice>
        </PageContentSurface>
      </RouteGuardFrame>
    );
  }

  return children;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isChecking) {
    return (
      <RouteSuspenseFallback
        loadingLabel="ログイン状態を確認中…"
        pathname={location.pathname}
        search={location.search}
      />
    );
  }

  if (!auth.auth?.isAdmin) {
    return (
      <PageFrame>
        <PageHeader title="管理者権限が必要です" />
        <PageContentSurface className="grid justify-items-start gap-4">
          <Notice tone="danger">この画面は管理者専用です。</Notice>
          <LinkButton to="/matches">試合一覧へ戻る</LinkButton>
        </PageContentSurface>
      </PageFrame>
    );
  }

  return children;
}
