import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";

import {
  buildLoginPath,
  currentAppPath,
  sanitizeAppRedirectPath,
} from "@/shared/auth/redirectPath";
import { useAuth } from "@/shared/auth/useAuth";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

function StandaloneRouteMain({ children }: { children: ReactNode }) {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full flex-col px-3 py-4 sm:px-4 sm:py-6"
      id="main-content"
    >
      {children}
    </main>
  );
}

function RouteGuardFrame({
  children,
  standalone = false,
}: {
  children: ReactNode;
  standalone?: boolean;
}) {
  const frame = <PageFrame>{children}</PageFrame>;

  if (standalone) {
    return <StandaloneRouteMain>{frame}</StandaloneRouteMain>;
  }

  return frame;
}

function AuthLoading({ message, standalone = false }: { message: string; standalone?: boolean }) {
  return (
    <RouteGuardFrame standalone={standalone}>
      <p className="text-sm text-[var(--color-text-secondary)]">{message}</p>
    </RouteGuardFrame>
  );
}

export function RootRedirect() {
  const auth = useAuth();

  if (auth.isChecking) {
    return <AuthLoading message="ログイン状態を確認しています…" standalone />;
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
    return <AuthLoading message="ログイン状態を確認しています…" standalone />;
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
    return <AuthLoading message="ログイン状態を確認しています…" standalone />;
  }

  if (auth.isUnauthorized) {
    const next = currentAppPath(location.pathname, location.search, location.hash);
    return <Navigate to={buildLoginPath(next)} replace />;
  }

  if (auth.isForbidden) {
    return (
      <RouteGuardFrame standalone>
        <Notice tone="danger" title="利用権限がありません">
          このアカウントは利用許可されていません。管理者に連絡してください。
        </Notice>
      </RouteGuardFrame>
    );
  }

  if (auth.error) {
    return (
      <RouteGuardFrame standalone>
        <Notice tone="danger" title={auth.error.title}>
          {auth.error.detail}
        </Notice>
        <div>
          <Button onClick={() => void auth.refetch()} variant="secondary">
            再試行
          </Button>
        </div>
      </RouteGuardFrame>
    );
  }

  return children;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.isChecking) {
    return <AuthLoading message="ログイン状態を確認しています…" />;
  }

  if (!auth.auth?.isAdmin) {
    return (
      <PageFrame>
        <Notice tone="danger" title="管理者権限が必要です">
          この画面は管理者だけが利用できます。
        </Notice>
      </PageFrame>
    );
  }

  return children;
}
