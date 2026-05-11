import {
  CalendarDays,
  Database,
  Download,
  LogIn,
  LogOut,
  ScanLine,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";

type NavItem = {
  icon: ReactNode;
  label: string;
  to: string;
};

const defaultItems: NavItem[] = [
  { icon: <CalendarDays className="size-4" />, label: "開催", to: "/held-events" },
  { icon: <Trophy className="size-4" />, label: "試合", to: "/matches" },
  { icon: <ScanLine className="size-4" />, label: "OCR", to: "/ocr/new" },
  { icon: <Download className="size-4" />, label: "出力", to: "/exports" },
];

const adminItems: NavItem[] = [
  { icon: <Database className="size-4" />, label: "マスタ", to: "/admin/masters" },
  { icon: <ShieldCheck className="size-4" />, label: "アカウント", to: "/admin/accounts" },
];

type GlobalNavProps = {
  authDisplayName?: string | undefined;
  className?: string;
  isAuthenticated?: boolean;
  isAdmin?: boolean;
  isLogoutPending?: boolean;
  items?: NavItem[];
  onLogout?: (() => void) | undefined;
};

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "inline-flex min-h-8 items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-1 text-sm font-semibold transition-colors duration-150 lg:min-h-9 lg:px-3 lg:py-1.5",
          "shrink-0",
          isActive
            ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]"
            : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)]",
        )
      }
    >
      <span aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  );
}

export function GlobalNav({
  authDisplayName,
  className,
  isAuthenticated = true,
  isAdmin = false,
  isLogoutPending = false,
  items = defaultItems,
  onLogout,
}: GlobalNavProps) {
  const primaryItems = isAuthenticated
    ? items
    : [{ icon: <LogIn className="size-4" />, label: "ログイン", to: "/login" }];
  const managementItems = isAuthenticated && isAdmin ? adminItems : [];

  return (
    <nav
      className={cn(
        "sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <div className="mx-auto grid w-full max-w-[75rem] min-w-0 grid-cols-1 gap-1.5 px-3 py-1.5 sm:px-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-2 lg:py-2">
        <div className="flex min-w-0 items-center justify-between gap-2 lg:contents">
          <div className="flex min-w-0 items-center gap-2 lg:col-start-1 lg:row-start-1">
            <p className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
              momo-result
            </p>
            {import.meta.env.DEV ? (
              <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                DEV
              </span>
            ) : null}
          </div>
          {isAuthenticated ? (
            <div className="ml-auto flex min-w-0 items-center gap-2 lg:col-start-3 lg:row-start-1 lg:justify-end">
              <p className="max-w-28 truncate text-xs text-[var(--color-text-secondary)]">
                {authDisplayName ?? "ログイン中"}
              </p>
              <Button
                icon={<LogOut className="size-4" />}
                onClick={onLogout}
                pending={isLogoutPending}
                pendingLabel="ログアウト中"
                size="sm"
                variant="secondary"
              >
                ログアウト
              </Button>
            </div>
          ) : null}
        </div>
        <div className="-mx-3 flex min-w-0 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto px-3 pb-1 lg:col-start-2 lg:row-start-1 lg:mx-0 lg:flex-wrap lg:justify-center lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden">
          {primaryItems.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
          {managementItems.length > 0 ? (
            <div className="ml-1 flex min-w-0 shrink-0 items-center gap-1.5 border-l border-[var(--color-border)] pl-2">
              {managementItems.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
