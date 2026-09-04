import type { ReactNode } from "react";

import {
  responsiveActionGroupClass,
  responsiveLeadActionGroupClass,
} from "@/shared/ui/actions/actionGroup";
import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import type { StatusBadgeTone } from "@/shared/ui/status/StatusBadge";

export type PageHeaderDescriptionStatus = {
  label: ReactNode;
  tone?: StatusBadgeTone | undefined;
};

type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  descriptionStatus?: PageHeaderDescriptionStatus | undefined;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
};

/** Keeps multi-action headers two-column and predictable until inline labels have enough room. */
export const responsivePageHeaderActionGroupClass = responsiveActionGroupClass;

/** Gives a mobile header one full-width lead action before the remaining compact actions. */
export const responsivePageHeaderLeadActionGroupClass = responsiveLeadActionGroupClass;

export function PageHeader({
  actions,
  description,
  descriptionStatus,
  eyebrow,
  meta,
  title,
}: PageHeaderProps) {
  return (
    <header className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="momo-label text-[var(--color-text-secondary)]">{eyebrow}</p>
        ) : null}
        <h1
          className={cn(
            "momo-heading text-2xl font-semibold text-balance text-[var(--color-text-primary)] md:text-3xl",
            eyebrow ? "mt-1" : "",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p
            className={cn(
              "momo-copy mt-2 text-sm text-[var(--color-text-secondary)]",
              readableTextWidthClass,
            )}
          >
            {description}
          </p>
        ) : null}
        {descriptionStatus ? (
          <div className="mt-2 w-fit">
            <StatusBadge label={descriptionStatus.label} tone={descriptionStatus.tone} />
          </div>
        ) : null}
      </div>
      {meta || actions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          {meta ? <div className="shrink-0">{meta}</div> : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
