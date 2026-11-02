import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link, useMatch, useResolvedPath } from "react-router-dom";

import { cn } from "@/shared/ui/cn";
import { pageFrameWidthClass, pageViewportGutterClass } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { globalNavigationId } from "@/shared/ui/layout/revealPageElement";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";
import { compactBadgeClass, compactBadgeToneClass } from "@/shared/ui/status/badgeRecipes";

export type GlobalNavItem = {
  current?: boolean;
  icon: ReactNode;
  label: string;
  to: string;
};

const emptyNavItems: readonly GlobalNavItem[] = [];

type GlobalNavProps = {
  brandLabel?: ReactNode;
  brandTo: string;
  /** The current page's width; navigation aligns its edges with that page content. */
  contentWidth?: PageFrameWidth | undefined;
  endContent?: ReactNode;
  environmentLabel?: string | undefined;
  items: readonly GlobalNavItem[];
  /** While the destinations depend on an unresolved session, keep their slot without painting it. */
  itemsPending?: boolean | undefined;
  managementItems?: readonly GlobalNavItem[];
  managementLabel?: string;
};

function NavItemLink({ item }: { item: GlobalNavItem }) {
  const surfaceRef = useSurfaceFeedback<HTMLAnchorElement>();
  const destination = useResolvedPath(item.to);
  const match = useMatch({ path: destination.pathname, end: destination.pathname === "/" });
  const current = item.current ?? match !== null;
  return (
    <Link
      ref={surfaceRef}
      to={item.to}
      aria-label={item.label}
      aria-current={current ? "page" : undefined}
      className={cn(
        "momo-surface momo-surface-press momo-surface-nav inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-sm border px-3 py-2 text-sm font-plain pointer-fine:min-h-9 pointer-fine:min-w-0 pointer-fine:py-1",
        current
          ? "momo-surface-nav-current border-[var(--color-action)]/60 text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)]",
      )}
    >
      <span aria-hidden="true" className="[&_svg]:size-4">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

/** Responds with the shared surface feedback, keeping its text and size like other nav links. */
function BrandLink({ children, to }: { children: ReactNode; to: string }) {
  const surfaceRef = useSurfaceFeedback<HTMLAnchorElement>();
  return (
    <Link
      ref={surfaceRef}
      className="momo-surface momo-surface-press font-structure inline-flex min-h-11 items-center rounded-sm px-2 py-1 text-sm text-[var(--color-text-primary)] pointer-fine:min-h-9"
      to={to}
    >
      {children}
    </Link>
  );
}

function revealActiveDestination(scroller: HTMLDivElement, activeLink: HTMLAnchorElement) {
  const scrollerRect = scroller.getBoundingClientRect();
  const activeLinkRect = activeLink.getBoundingClientRect();

  if (activeLinkRect.left < scrollerRect.left) {
    scroller.scrollLeft += activeLinkRect.left - scrollerRect.left;
  } else if (activeLinkRect.right > scrollerRect.right) {
    scroller.scrollLeft += activeLinkRect.right - scrollerRect.right;
  }
}

export function GlobalNav({
  brandLabel = "momo-result",
  brandTo,
  contentWidth = "default",
  endContent,
  environmentLabel,
  items,
  itemsPending = false,
  managementItems = emptyNavItems,
  managementLabel = "管理",
}: GlobalNavProps) {
  const navItemsRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // Readable pages are too narrow for every destination, so navigation keeps the default width.
  const navigationWidth = contentWidth === "readable" ? "default" : contentWidth;

  // Explicit current flags and labels also affect the active link and its geometry.
  // Synchronize the rendered DOM after each commit instead of duplicating that identity.
  useEffect(() => {
    const scroller = navItemsRef.current;
    const activeLink = scroller?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    if (scroller && activeLink) {
      revealActiveDestination(scroller, activeLink);
    }
  });

  // Sticky content offsets itself with --sticky-below-nav, so it follows wrapping and pointer size.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--global-nav-height", `${nav.offsetHeight}px`);
    });
    observer.observe(nav);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--global-nav-height");
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="グローバルナビゲーション"
      id={globalNavigationId}
      className={cn(
        "sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-surface)]",
        pageViewportGutterClass,
      )}
    >
      <div
        className={cn(
          "mx-auto grid w-full min-w-0 grid-cols-1 gap-2 py-2 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
          pageFrameWidthClass[navigationWidth],
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-2 lg:contents">
          <div className="flex min-w-0 items-center gap-2 lg:col-start-1 lg:row-start-1">
            <BrandLink to={brandTo}>{brandLabel}</BrandLink>
            {environmentLabel ? (
              <span className={cn(compactBadgeClass, compactBadgeToneClass.neutral)}>
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
          aria-hidden={itemsPending || undefined}
          className={cn(
            "-mx-3 flex min-w-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4 lg:col-start-2 lg:row-start-1 lg:mx-0 lg:flex-wrap lg:justify-center lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden",
            // Centered destinations would slide sideways when permitted items join after the
            // session resolves, so they first appear at their final positions.
            itemsPending && "invisible",
          )}
          inert={itemsPending || undefined}
          data-nav-scroll
        >
          {items.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
          {managementItems.length > 0 ? (
            <>
              <span aria-hidden="true" className="h-6 w-px shrink-0 bg-[var(--color-border)]" />
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
