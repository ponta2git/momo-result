import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";

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

function buildNextPath(pathname: string, search: string, hash: string) {
  return `${pathname}${search}${hash}`;
}

export function RootRedirect() {
  const auth = useAuth();

  if (auth.isChecking) {
    return <AuthLoading message="認証状態を確認中です..." />;
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
    return <AuthLoading message="認証状態を確認中です..." />;
  }

  if (auth.isAuthenticated) {
    const next = searchParams.get("next");
    const destination = next && next.startsWith("/") ? next : "/matches";
    return <Navigate to={destination} replace />;
  }

  return children;
}

export function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isChecking) {
    return <AuthLoading message="認証状態を確認中です..." />;
  }

  if (auth.isUnauthorized) {
    const next = buildNextPath(location.pathname, location.search, location.hash);
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
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
    return <AuthLoading message="認証状態を確認中です..." />;
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
