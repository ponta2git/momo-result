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
          "inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm font-semibold transition-colors duration-150",
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
      <div className="mx-auto grid w-full max-w-[75rem] min-w-0 gap-2 px-3 py-2 sm:px-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <p className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
            momo-result
          </p>
          {import.meta.env.DEV ? (
            <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
              DEV
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:justify-center">
          {primaryItems.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
          {managementItems.length > 0 ? (
            <div className="ml-0 flex min-w-0 flex-wrap items-center gap-1.5 border-t border-[var(--color-border)] pt-1.5 sm:ml-1 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-2">
              {managementItems.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </div>
          ) : null}
        </div>
        {isAuthenticated ? (
          <div className="flex min-w-0 items-center gap-2 lg:justify-end">
            <p className="truncate text-xs text-[var(--color-text-secondary)]">
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
    </nav>
  );
}
