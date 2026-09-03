import { ArrowLeft, PenSquare, ScanLine } from "lucide-react";
import type { ReactNode } from "react";

import { routeTerminalPresentation } from "@/app/RouteSuspenseFallback";
import type {
  RouteHeaderActionPresentation,
  RouteHeaderActionsPresentation,
  RouteNavigationPresentation,
} from "@/app/RouteSuspenseFallback";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader, responsivePageHeaderActionGroupClass } from "@/shared/ui/layout/PageHeader";

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
  return null;
}

function HeaderActions({ items, label, layout = "inline" }: RouteHeaderActionsPresentation) {
  const actions = items.map((item) => (
    <LinkButton
      icon={item.icon ? <HeaderActionIcon icon={item.icon} /> : undefined}
      key={`${item.href}:${item.label}`}
      size={item.size ?? "md"}
      to={item.href}
      variant="secondary"
    >
      {item.label}
    </LinkButton>
  ));

  if (layout === "responsive-grid") {
    return (
      <div
        aria-label={label}
        className={responsivePageHeaderActionGroupClass}
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

  return (
    <PageFrame width={presentation.width}>
      {presentation.leadingNavigation ? (
        <div>
          <ReturnLink {...presentation.leadingNavigation} />
        </div>
      ) : null}
      <PageHeader
        actions={
          presentation.headerNavigation ? (
            <HeaderNavigationLink {...presentation.headerNavigation} />
          ) : presentation.headerActions ? (
            <HeaderActions {...presentation.headerActions} />
          ) : null
        }
        description={presentation.description}
        eyebrow={presentation.eyebrow}
        title={title}
      />
      {presentation.contextNavigation ? (
        <Notice
          action={<ReturnLink {...presentation.contextNavigation} />}
          title="元の画面へ戻れます"
          tone="info"
        >
          この画面を開く前の場所へ戻ることができます。
        </Notice>
      ) : null}
      <PageContentSurface className={contentClassName} padding={presentation.contentPadding}>
        {children}
      </PageContentSurface>
    </PageFrame>
  );
}
