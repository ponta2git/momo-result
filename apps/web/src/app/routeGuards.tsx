import { Activity, Fragment, useEffect } from "react";
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
import { useAuthorization } from "@/shared/auth/useAuthorization";
import { useAuthStatus } from "@/shared/auth/useAuthStatus";
import { GlobalNav } from "@/shared/navigation/GlobalNav";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PortalContainer } from "@/shared/ui/feedback/PortalContainer";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

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
  width = "default",
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
    <RouteGuardFrame standalone width="readable">
      <PageContentSurface aria-busy="true" aria-label="ログイン状態を確認中" role="region">
        <div aria-hidden="true" className="grid gap-4">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-20 w-full" />
        </div>
      </PageContentSurface>
    </RouteGuardFrame>
  );
}

/** Holds the requested route's structural skeleton, so a session check keeps width and slots. */
function AuthLoading({ message, standalone = false }: { message: string; standalone?: boolean }) {
  const location = useLocation();
  const fallback = (
    <RouteSuspenseFallback
      loadingLabel={message}
      pathname={location.pathname}
      search={location.search}
    />
  );
  return standalone ? <StandaloneRouteMain>{fallback}</StandaloneRouteMain> : fallback;
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

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const auth = useAuthStatus();
  const [searchParams] = useSearchParams();

  if (auth.isChecking) {
    return <LoginAuthLoading />;
  }

  if (auth.isAuthenticated) {
    const destination = sanitizeAppRedirectPath(searchParams.get("next")) ?? "/";
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
  const authorization = useAuthorization();
  const { auth } = authorization;
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

  // A failed refresh does not end the confirmed account's ordinary editing session.
  // Management routes retain their separate permission pause below AppShell.
  if (auth.error && !auth.auth) {
    return (
      <ProtectedRouteMain>
        <AuthUnavailable pending={auth.isRefetching} onRetry={() => void auth.refetch()} />
      </ProtectedRouteMain>
    );
  }

  return <Fragment key={auth.auth?.accountId}>{children}</Fragment>;
}

/** Keep an invalid URL inspectable and offer a known destination without silently redirecting. */
export function NotFoundRoute() {
  const auth = useAuthStatus();
  const content = (
    <PageFrame width="readable">
      <PageContentSurface
        aria-label="ページが見つかりません"
        className="grid justify-items-start gap-4"
        role="region"
      >
        <div className="grid gap-1">
          <h1 className={contentText.heading}>ページが見つかりません</h1>
          <p className={contentText.body}>
            URLを確認するか、以下のリンクから画面を開き直してください。
          </p>
        </div>
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

export function OperationsRoute({ children }: { children: ReactNode }) {
  const authorization = useAuthorization();
  const { auth } = authorization;
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

  if (!authorization.retained.operations) {
    return (
      <RouteTerminalPage
        contentClassName="grid justify-items-start gap-4"
        pathname={location.pathname}
        search={location.search}
        title="運用担当の権限が必要です"
      >
        <Notice tone="danger">この画面は運用担当・管理者専用です。</Notice>
      </RouteTerminalPage>
    );
  }

  return (
    <>
      {authorization.paused ? (
        auth.error ? (
          <AuthUnavailable
            pending={auth.isRefetching}
            onRetry={() => void authorization.recheck()}
          />
        ) : (
          <AuthLoading message="権限を確認中…" />
        )
      ) : null}
      <Activity mode={authorization.paused ? "hidden" : "visible"}>
        <PortalContainer>{children}</PortalContainer>
      </Activity>
    </>
  );
}
