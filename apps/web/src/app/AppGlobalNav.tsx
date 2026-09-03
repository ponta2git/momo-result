import {
  Activity,
  BarChart3,
  CalendarDays,
  Database,
  Download,
  LogOut,
  ScanLine,
  ShieldCheck,
  Trophy,
} from "lucide-react";

import { useAuth } from "@/shared/auth/useAuth";
import { Button } from "@/shared/ui/actions/Button";
import { GlobalNav } from "@/shared/ui/layout/GlobalNav";
import type { GlobalNavItem } from "@/shared/ui/layout/GlobalNav";

const primaryItems = [
  { icon: <Trophy />, label: "試合", to: "/matches" },
  { icon: <BarChart3 />, label: "戦績比較", to: "/analytics/series" },
  { icon: <ScanLine />, label: "OCR", to: "/ocr/new" },
  { icon: <CalendarDays />, label: "開催", to: "/held-events" },
  { icon: <Download />, label: "出力", to: "/exports" },
] as const satisfies readonly GlobalNavItem[];

const adminItems = [
  { icon: <Activity />, label: "分析", to: "/admin/analysis" },
  { icon: <Database />, label: "設定", to: "/admin/masters" },
  { icon: <ShieldCheck />, label: "アカウント", to: "/admin/accounts" },
] as const satisfies readonly GlobalNavItem[];

const noManagementItems: readonly GlobalNavItem[] = [];

export function AppGlobalNav() {
  const auth = useAuth();
  const canLogout = import.meta.env.DEV && auth.isAuthenticated && Boolean(auth.logout);
  const logoutFailed = Boolean(auth.logoutError);
  const sessionLabel =
    auth.auth?.displayName ??
    (auth.isChecking
      ? "確認中"
      : auth.error
        ? "状態不明"
        : auth.isAuthenticated
          ? "ログイン中"
          : "未ログイン");

  return (
    <GlobalNav
      brandTo="/matches"
      endContent={
        <div className="grid max-w-full min-w-0 justify-items-end gap-1">
          <div className="flex max-w-full min-w-0 items-center justify-end gap-2">
            <p className="hidden max-w-28 truncate text-xs text-[var(--color-text-secondary)] min-[24rem]:block">
              {sessionLabel}
            </p>
            {canLogout ? (
              <div className="shrink-0">
                <Button
                  aria-describedby={logoutFailed ? "global-nav-logout-error" : undefined}
                  aria-label={logoutFailed ? "ログアウトを再試行" : undefined}
                  icon={<LogOut />}
                  onClick={auth.logout}
                  pending={auth.isLogoutPending}
                  pendingLabel="ログアウト中"
                  size="sm"
                  variant={logoutFailed ? "primary" : "secondary"}
                >
                  {logoutFailed ? "再試行" : "ログアウト"}
                </Button>
              </div>
            ) : null}
          </div>
          {logoutFailed && canLogout ? (
            <p
              className="max-w-72 text-right text-xs leading-5 break-words text-[var(--color-danger)]"
              id="global-nav-logout-error"
              role="alert"
            >
              <span className="font-semibold">ログアウトできませんでした。</span>
              ログイン状態と表示中の内容は保持しています。通信状態を確認して再試行してください。
            </p>
          ) : null}
        </div>
      }
      environmentLabel={import.meta.env.DEV ? "DEV" : undefined}
      items={primaryItems}
      managementItems={auth.auth?.isAdmin ? adminItems : noManagementItems}
    />
  );
}
