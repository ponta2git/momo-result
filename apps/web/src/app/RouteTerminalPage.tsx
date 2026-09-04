import { ArrowLeft, Download, ListFilter, PenSquare, ScanLine } from "lucide-react";
import type { ReactNode } from "react";

import { routeTerminalPresentation } from "@/app/RouteSuspenseFallback";
import type {
  RouteHeaderActionPresentation,
  RouteHeaderActionsPresentation,
  RouteNavigationPresentation,
} from "@/app/RouteSuspenseFallback";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import {
  PageHeader,
  responsivePageHeaderActionGroupClass,
  responsivePageHeaderLeadActionGroupClass,
} from "@/shared/ui/layout/PageHeader";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";

type RouteTerminalPageProps = {
  children: ReactNode;
  contentClassName?: string | undefined;
  pathname: string;
  search?: string | undefined;
  title: ReactNode;
};

function ReturnLink({ href, label }: { href: string; label: string }) {
  return (
    <LinkButton icon={<ArrowLeft aria-hidden="true" />} size="sm" to={href} variant="quiet">
      {label}
    </LinkButton>
  );
}

function HeaderNavigationLink({ href, icon, label }: RouteNavigationPresentation) {
  return (
    <LinkButton
      icon={icon === "back" ? <ArrowLeft aria-hidden="true" /> : undefined}
      size="sm"
      to={href}
      variant="quiet"
    >
      {label}
    </LinkButton>
  );
}

function HeaderActionIcon({ icon }: Pick<RouteHeaderActionPresentation, "icon">) {
  if (icon === "scan") return <ScanLine aria-hidden="true" />;
  if (icon === "manual") return <PenSquare aria-hidden="true" />;
  if (icon === "filter") return <ListFilter aria-hidden="true" />;
  if (icon === "download") return <Download aria-hidden="true" />;
  return null;
}

function HeaderActions({
  items,
  label,
  layout = "inline",
  semantics = "group",
}: RouteHeaderActionsPresentation) {
  const actions = items.map((item) => (
    <LinkButton
      icon={item.icon ? <HeaderActionIcon icon={item.icon} /> : undefined}
      key={`${item.href}:${item.label}`}
      size={item.size ?? "md"}
      to={item.href}
      variant={item.variant ?? "secondary"}
    >
      {item.label}
    </LinkButton>
  ));

  if (layout !== "inline") {
    const className =
      layout === "responsive-lead"
        ? responsivePageHeaderLeadActionGroupClass
        : responsivePageHeaderActionGroupClass;
    if (semantics === "navigation") {
      return (
        <nav aria-label={label} className={className} data-page-header-actions={layout}>
          {actions}
        </nav>
      );
    }
    return (
      <div
        aria-label={label}
        className={className}
        data-page-header-actions={layout}
        role={label ? "group" : undefined}
      >
        {actions}
      </div>
    );
  }

  return actions;
}

/** Keeps route-level error and access states in the same page composition as loading and ready. */
export function RouteTerminalPage({
  children,
  contentClassName,
  pathname,
  search = "",
  title,
}: RouteTerminalPageProps) {
  const presentation = routeTerminalPresentation(pathname, search);
  const pageActions = presentation.headerNavigation ? (
    <HeaderNavigationLink {...presentation.headerNavigation} />
  ) : presentation.headerActions ? (
    <HeaderActions {...presentation.headerActions} />
  ) : null;
  const contentToolbar =
    !presentation.preserveHeader && (pageActions || presentation.descriptionStatus) ? (
      <div
        className={cn(
          actionRowClass,
          presentation.descriptionStatus ? "justify-between" : "justify-end",
        )}
        data-page-content-actions=""
      >
        {presentation.descriptionStatus ? (
          <StatusBadge {...presentation.descriptionStatus} />
        ) : null}
        {pageActions}
      </div>
    ) : null;

  return (
    <PageFrame width={presentation.width}>
      {presentation.leadingNavigation ? (
        <div>
          <ReturnLink {...presentation.leadingNavigation} />
        </div>
      ) : null}
      {presentation.preserveHeader ? (
        <PageHeader
          actions={pageActions}
          description={presentation.description}
          descriptionStatus={presentation.descriptionStatus}
          eyebrow={presentation.eyebrow}
          title={title}
        />
      ) : null}
      {presentation.contextNavigation ? (
        <Notice
          action={<ReturnLink {...presentation.contextNavigation} />}
          title="元の画面へ戻れます"
          tone="info"
        >
          この画面を開く前の場所へ戻ることができます。
        </Notice>
      ) : null}
      <PageContentSurface
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(contentToolbar ? "grid gap-4" : "", contentClassName)}
        padding={presentation.contentPadding}
        role={typeof title === "string" ? "region" : undefined}
      >
        {contentToolbar}
        {children}
      </PageContentSurface>
    </PageFrame>
  );
}
