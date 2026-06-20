import {
  BarChart3,
  CalendarDays,
  Database,
  Download,
  LogIn,
  LogOut,
  ScanLine,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { momoSpring } from "@/shared/ui/motion/variants";

type NavItem = {
  icon: ReactNode;
  label: string;
  to: string;
};

const defaultItems: NavItem[] = [
  { icon: <Trophy className="size-4" />, label: "試合", to: "/matches" },
  { icon: <BarChart3 className="size-4" />, label: "戦績比較", to: "/analytics/series" },
  { icon: <ScanLine className="size-4" />, label: "OCR", to: "/ocr/new" },
  { icon: <CalendarDays className="size-4" />, label: "開催", to: "/held-events" },
  { icon: <Download className="size-4" />, label: "出力", to: "/exports" },
];

const adminItems: NavItem[] = [
  { icon: <Database className="size-4" />, label: "設定", to: "/admin/masters" },
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
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          "relative isolate inline-flex min-h-8 shrink-0 items-center gap-2 overflow-hidden rounded-[var(--radius-sm)] border px-2.5 py-1 text-sm font-semibold transition-colors duration-150 lg:min-h-9 lg:px-3 lg:py-1.5",
          isActive
            ? "border-[var(--color-action)]/60 text-[var(--color-text-primary)]"
            : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)]",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 z-0 rounded-[var(--radius-sm)] bg-[var(--color-action)]/12"
              layoutId="global-nav-active"
              transition={momoSpring}
            />
          ) : null}
          <span aria-hidden="true" className="relative z-[var(--z-base)]">
            {item.icon}
          </span>
          <span className="relative z-[var(--z-base)] max-[26rem]:sr-only">{item.label}</span>
        </>
      )}
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
            <Link
              className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-1 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-selected)]"
              to={isAuthenticated ? "/matches" : "/login"}
            >
              momo-result
            </Link>
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
