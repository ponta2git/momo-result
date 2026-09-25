import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";

import { AppGlobalNav } from "@/app/AppGlobalNav";
import { AppPageCanvas } from "@/app/AppPageCanvas";
import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";
import { RouteTerminalPage } from "@/app/RouteTerminalPage";
import { clearAccountOperationNotice } from "@/shared/auth/accountOperationNotice";
import { loginNavItems } from "@/shared/auth/loginNavigation";
import {
  buildLoginPath,
  currentAppPath,
  sanitizeAppRedirectPath,
} from "@/shared/auth/redirectPath";
import { useAuth } from "@/shared/auth/useAuth";
import { GlobalNav } from "@/shared/navigation/GlobalNav";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

function StandaloneRouteMain({ children }: { children: ReactNode }) {
  return (
    <AppPageCanvas
      navigation={
        <GlobalNav
          brandTo="/login"
          environmentLabel={import.meta.env.DEV ? "DEV" : undefined}
          items={loginNavItems}
        />
      }
    >
      {children}
    </AppPageCanvas>
  );
}

function ProtectedRouteMain({ children }: { children: ReactNode }) {
  return <AppPageCanvas navigation={<AppGlobalNav />}>{children}</AppPageCanvas>;
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
      <div className="mx-auto w-full max-w-[34rem]">
        <PageContentSurface aria-busy="true" aria-label="ログイン状態を確認中" role="region">
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
        <p className="font-emphasis text-sm text-[var(--color-text-primary)]">{message}</p>
        <div className="mt-4 grid gap-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-20 w-full" />
        </div>
      </PageContentSurface>
    </RouteGuardFrame>
  );
}

function AuthUnavailable({ pending, onRetry }: { pending: boolean; onRetry: () => void }) {
  const location = useLocation();
  return (
    <RouteTerminalPage
      pathname={location.pathname}
      search={location.search}
      title="ログイン状態を確認できません"
    >
      <Notice
        action={
          <Button pending={pending} pendingLabel="再試行中…" onClick={onRetry}>
            再試行
          </Button>
        }
        tone="danger"
      >
        ログイン状態を確認できないため、この画面の表示を一時停止しています。通信状態を確認して、再試行してください。
      </Notice>
    </RouteTerminalPage>
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

  if (auth.error && !auth.isUnauthorized) {
    return (
      <StandaloneRouteMain>
        <AuthUnavailable pending={auth.isRefetching} onRetry={() => void auth.refetch()} />
      </StandaloneRouteMain>
    );
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

  if (auth.error && !auth.isUnauthorized && !auth.isForbidden) {
    return (
      <StandaloneRouteMain>
        <AuthUnavailable pending={auth.isRefetching} onRetry={() => void auth.refetch()} />
      </StandaloneRouteMain>
    );
  }

  return <StandaloneRouteMain>{children}</StandaloneRouteMain>;
}

export function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  useEffect(() => {
    if (auth.isAuthenticated && auth.auth?.accountId) clearAccountOperationNotice();
  }, [auth.isAuthenticated, auth.auth?.accountId]);
  const location = useLocation();

  if (auth.isChecking) {
    return (
      <ProtectedRouteMain>
        <RouteSuspenseFallback
          loadingLabel="ログイン状態を確認中…"
          pathname={location.pathname}
          search={location.search}
        />
      </ProtectedRouteMain>
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
      <ProtectedRouteMain>
        <AuthUnavailable pending={auth.isRefetching} onRetry={() => void auth.refetch()} />
      </ProtectedRouteMain>
    );
  }

  return children;
}

/** Keep an invalid URL inspectable and offer a known destination without silently redirecting. */
export function NotFoundRoute() {
  const auth = useAuth();
  const content = (
    <PageFrame width="narrow">
      <PageHeader title="ページが見つかりません" />
      <PageContentSurface className="grid justify-items-start gap-4">
        <p>URLを確認するか、以下のリンクから画面を開き直してください。</p>
        <LinkButton to={auth.isAuthenticated ? "/matches" : "/login"}>
          {auth.isAuthenticated ? "試合一覧へ戻る" : "ログイン画面へ"}
        </LinkButton>
      </PageContentSurface>
    </PageFrame>
  );
  return auth.isAuthenticated ? (
    <ProtectedRouteMain>{content}</ProtectedRouteMain>
  ) : (
    <StandaloneRouteMain>{content}</StandaloneRouteMain>
  );
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
      <RouteTerminalPage
        contentClassName="grid justify-items-start gap-4"
        pathname={location.pathname}
        search={location.search}
        title="管理者権限が必要です"
      >
        <Notice tone="danger">この画面は管理者専用です。</Notice>
        <LinkButton to="/matches">試合一覧へ戻る</LinkButton>
      </RouteTerminalPage>
    );
  }

  return children;
}
