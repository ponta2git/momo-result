import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { routeTerminalPresentation } from "@/app/RouteSuspenseFallback";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import { contentText } from "@/shared/ui/typography";

type RouteTerminalPageProps = {
  children: ReactNode;
  contentClassName?: string | undefined;
  pathname: string;
  search?: string | undefined;
  title: ReactNode;
};

/** Shares the route layout; the failure owner supplies its available recovery actions. */
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
      {presentation.backLink ? (
        <div>
          <LinkButton
            icon={<ArrowLeft aria-hidden="true" />}
            size="sm"
            to={presentation.backLink.href}
            variant="quiet"
          >
            {presentation.backLink.label}
          </LinkButton>
        </div>
      ) : null}
      {presentation.preserveHeader ? (
        <PageHeader description={presentation.description} title={title} />
      ) : null}
      <PageContentSurface
        aria-label={typeof title === "string" ? title : undefined}
        className={cn("grid gap-4", contentClassName)}
        padding={presentation.contentPadding}
        role={typeof title === "string" ? "region" : undefined}
      >
        {presentation.descriptionStatus ? (
          <div className="justify-self-end">
            <StatusBadge {...presentation.descriptionStatus} />
          </div>
        ) : null}
        {presentation.preserveHeader ? null : <h2 className={contentText.heading}>{title}</h2>}
        {children}
      </PageContentSurface>
    </PageFrame>
  );
}
