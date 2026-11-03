import {
  Activity,
  Award,
  BarChart3,
  CalendarDays,
  Database,
  LogOut,
  NotebookPen,
  Trophy,
} from "lucide-react";
import { useLocation, useMatch } from "react-router-dom";

import { routePageWidth } from "@/app/RouteSuspenseFallback";
import { hasOperationsRole } from "@/shared/auth/permissions";
import { useAuthSession } from "@/shared/auth/useAuthSession";
import { GlobalNav } from "@/shared/navigation/GlobalNav";
import type { GlobalNavItem } from "@/shared/navigation/GlobalNav";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { fieldText } from "@/shared/ui/typography";

// Destinations are the recorded objects (開催 ⊃ 試合) and the views across them. Ways of recording
// (OCR取り込み・手入力) live inside 記録する, and 出力 is reached from the records it carries out.
const primaryItems = [
  { icon: <CalendarDays />, label: "開催", to: "/held-events" },
  { icon: <Trophy />, label: "試合", to: "/matches" },
  { icon: <BarChart3 />, label: "戦績比較", to: "/analytics/series" },
  { icon: <Award />, label: "実績", to: "/achievements" },
] as const satisfies readonly GlobalNavItem[];

/** Opens the newest held event's hub, where the next match is recorded or a new event starts. */
const recordAction = {
  icon: <NotebookPen />,
  label: "記録する",
  to: "/",
} as const satisfies GlobalNavItem;

const managementItems = [
  { icon: <Activity />, label: "分析", to: "/admin/analysis" },
  { icon: <Database />, label: "設定", to: "/admin/masters" },
] as const satisfies readonly GlobalNavItem[];

const noManagementItems: readonly GlobalNavItem[] = [];

export function AppGlobalNav() {
  const auth = useAuthSession();
  const location = useLocation();
  // Capturing, reviewing, entering, and resuming drafts are all recording until confirmed.
  const capturing = useMatch("/ocr/new") !== null;
  const reviewing = useMatch("/review/:matchSessionId") !== null;
  const entering = useMatch("/matches/new") !== null;
  const resumingDrafts = useMatch("/drafts") !== null;
  const recording = capturing || reviewing || entering || resumingDrafts;
  const publicMatch = useMatch("/m/:publicId") !== null;
  const publicHeldEvent = useMatch("/e/:publicId") !== null;
  // 出力 carries confirmed matches out, so it stays in the matches area.
  const exporting = useMatch("/exports") !== null;
  const currentArea = recording
    ? "record"
    : publicMatch || exporting
      ? "/matches"
      : publicHeldEvent
        ? "/held-events"
        : undefined;
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
      action={{ ...recordAction, current: currentArea === "record" }}
      brandTo="/"
      contentWidth={routePageWidth(location.pathname, location.search)}
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
              className={cn(fieldText.error, "max-w-72 text-right break-words")}
              id="global-nav-logout-error"
              role="alert"
            >
              <span className="font-emphasis">ログアウトできませんでした。</span>
              ログイン状態と表示中の内容は保持しています。通信状態を確認して再試行してください。
            </p>
          ) : null}
        </div>
      }
      environmentLabel={import.meta.env.DEV ? "DEV" : undefined}
      itemsPending={auth.isChecking}
      items={
        currentArea
          ? primaryItems.map((item) => ({ ...item, current: item.to === currentArea }))
          : primaryItems
      }
      managementItems={
        auth.isAuthenticated &&
        !auth.error &&
        !auth.isRefetching &&
        hasOperationsRole(auth.auth?.role)
          ? managementItems
          : noManagementItems
      }
    />
  );
}
