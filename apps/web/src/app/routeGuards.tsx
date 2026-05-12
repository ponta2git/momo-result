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

function AuthLoading({ message }: { message: string }) {
  return (
    <PageFrame>
      <p className="text-sm text-[var(--color-text-secondary)]">{message}</p>
    </PageFrame>
  );
}

export function RootRedirect() {
  const auth = useAuth();

  if (auth.isChecking) {
    return <AuthLoading message="ログイン状態を確認しています…" />;
  }

  if (auth.isForbidden) {
    return <Navigate to="/login?reason=forbidden" replace />;
  }

  if (auth.isAuthenticated) {
    return <Navigate to="/held-events" replace />;
  }

  return <Navigate to="/login" replace />;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [searchParams] = useSearchParams();

  if (auth.isChecking) {
    return <AuthLoading message="ログイン状態を確認しています…" />;
  }

  if (auth.isAuthenticated) {
    const destination = sanitizeAppRedirectPath(searchParams.get("next")) ?? "/held-events";
    return <Navigate to={destination} replace />;
  }

  return children;
}

export function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isChecking) {
    return <AuthLoading message="ログイン状態を確認しています…" />;
  }

  if (auth.isUnauthorized) {
    const next = currentAppPath(location.pathname, location.search, location.hash);
    return <Navigate to={buildLoginPath(next)} replace />;
  }

  if (auth.isForbidden) {
    return (
      <PageFrame>
        <Notice tone="danger" title="利用権限がありません">
          このアカウントは利用許可されていません。管理者に連絡してください。
        </Notice>
      </PageFrame>
    );
  }

  if (auth.error) {
    return (
      <PageFrame>
        <Notice tone="danger" title={auth.error.title}>
          {auth.error.detail}
        </Notice>
        <div>
          <Button onClick={() => void auth.refetch()} variant="secondary">
            再試行
          </Button>
        </div>
      </PageFrame>
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
