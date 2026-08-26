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
  { icon: <Trophy className="size-4" />, label: "試合", to: "/matches" },
  { icon: <BarChart3 className="size-4" />, label: "戦績比較", to: "/analytics/series" },
  { icon: <ScanLine className="size-4" />, label: "OCR", to: "/ocr/new" },
  { icon: <CalendarDays className="size-4" />, label: "開催", to: "/held-events" },
  { icon: <Download className="size-4" />, label: "出力", to: "/exports" },
] as const satisfies readonly GlobalNavItem[];

const adminItems = [
  { icon: <Activity className="size-4" />, label: "分析", to: "/admin/analysis" },
  { icon: <Database className="size-4" />, label: "設定", to: "/admin/masters" },
  { icon: <ShieldCheck className="size-4" />, label: "アカウント", to: "/admin/accounts" },
] as const satisfies readonly GlobalNavItem[];

const noManagementItems: readonly GlobalNavItem[] = [];

export function AppGlobalNav() {
  const auth = useAuth();
  const canLogout = import.meta.env.DEV && Boolean(auth.logout);
  const logoutFailed = Boolean(auth.logoutError);

  return (
    <GlobalNav
      brandTo="/matches"
      endContent={
        <div className="grid max-w-full min-w-0 justify-items-end gap-1">
          <div className="flex max-w-full min-w-0 items-center justify-end gap-2">
            <p className="hidden max-w-28 truncate text-xs text-[var(--color-text-secondary)] min-[24rem]:block">
              {auth.auth?.displayName ?? "ログイン中"}
            </p>
            {canLogout ? (
              <Button
                aria-describedby={logoutFailed ? "global-nav-logout-error" : undefined}
                aria-label={logoutFailed ? "ログアウトを再試行" : undefined}
                className="shrink-0"
                icon={<LogOut className="size-4" />}
                onClick={auth.logout}
                pending={auth.isLogoutPending}
                pendingLabel="ログアウト中"
                size="sm"
                variant={logoutFailed ? "primary" : "secondary"}
              >
                {logoutFailed ? "再試行" : "ログアウト"}
              </Button>
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
