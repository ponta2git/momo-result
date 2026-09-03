import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { cn } from "@/shared/ui/cn";
import { pageViewportGutterClass } from "@/shared/ui/layout/PageFrame";

export type GlobalNavItem = {
  icon: ReactNode;
  label: string;
  to: string;
};

const emptyNavItems: readonly GlobalNavItem[] = [];

type GlobalNavProps = {
  brandLabel?: ReactNode;
  brandTo: string;
  endContent?: ReactNode;
  environmentLabel?: string | undefined;
  items: readonly GlobalNavItem[];
  managementItems?: readonly GlobalNavItem[];
  managementLabel?: string;
};

function NavItemLink({ item }: { item: GlobalNavItem }) {
  return (
    <NavLink
      to={item.to}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-sm border px-3 py-2 text-sm font-semibold pointer-fine:min-h-9 pointer-fine:min-w-0 pointer-fine:py-1",
          isActive
            ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]"
            : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]",
        )
      }
    >
      <span aria-hidden="true" className="[&_svg]:size-4">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </NavLink>
  );
}

export function GlobalNav({
  brandLabel = "momo-result",
  brandTo,
  endContent,
  environmentLabel,
  items,
  managementItems = emptyNavItems,
  managementLabel = "管理",
}: GlobalNavProps) {
  const location = useLocation();
  const navItemsRef = useRef<HTMLDivElement>(null);
  const destinationSignature = [...items, ...managementItems].map((item) => item.to).join("\0");

  useEffect(() => {
    const activeLink =
      navItemsRef.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    activeLink?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [destinationSignature, location.pathname]);

  return (
    <nav
      aria-label="グローバルナビゲーション"
      className="sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div
        className={cn(
          "mx-auto grid w-full max-w-[120rem] min-w-0 grid-cols-1 gap-2 py-2 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
          pageViewportGutterClass,
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-2 lg:contents">
          <div className="flex min-w-0 items-center gap-2 lg:col-start-1 lg:row-start-1">
            <Link
              className="-ml-1 inline-flex min-h-11 items-center rounded-xs px-1 py-1 text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-action)] pointer-fine:min-h-9"
              to={brandTo}
            >
              {brandLabel}
            </Link>
            {environmentLabel ? (
              <span className="rounded-xs border border-[var(--color-border)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
                {environmentLabel}
              </span>
            ) : null}
          </div>
          {endContent ? (
            <div className="ml-auto min-w-0 lg:col-start-3 lg:row-start-1">{endContent}</div>
          ) : null}
        </div>
        <div
          ref={navItemsRef}
          className="-mx-3 flex min-w-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto px-3 pb-1 lg:col-start-2 lg:row-start-1 lg:mx-0 lg:flex-wrap lg:justify-center lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
          data-nav-scroll
        >
          {items.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
          {managementItems.length > 0 ? (
            <>
              <span
                aria-hidden="true"
                className="ml-1 h-6 w-px shrink-0 bg-[var(--color-border)]"
              />
              <div
                aria-label={managementLabel}
                className="flex min-w-0 shrink-0 items-center gap-2"
                role="group"
              >
                <span className="momo-label shrink-0 text-[var(--color-text-secondary)]">
                  {managementLabel}
                </span>
                {managementItems.map((item) => (
                  <NavItemLink key={item.to} item={item} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
