import type { ReactNode, Ref } from "react";

import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import type { StatusBadgeTone } from "@/shared/ui/status/StatusBadge";
import { contentText } from "@/shared/ui/typography";

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
  titleRef?: Ref<HTMLHeadingElement> | undefined;
  titleDescriptionId?: string | undefined;
};

export function PageHeader({
  actions,
  description,
  descriptionStatus,
  eyebrow,
  meta,
  title,
  titleRef,
  titleDescriptionId,
}: PageHeaderProps) {
  return (
    <header className="@container/page-header flex min-w-0 flex-wrap items-end gap-4">
      <div className="min-w-0 flex-[1_1_24rem]">
        {eyebrow ? <p className={contentText.supporting}>{eyebrow}</p> : null}
        <h1
          ref={titleRef}
          aria-describedby={titleDescriptionId}
          tabIndex={titleRef ? -1 : undefined}
          className={cn(
            "momo-heading text-2xl font-structure text-balance text-[var(--color-text-primary)] @3xl/page-header:text-3xl",
            eyebrow ? "mt-1" : "",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className={cn(contentText.body, "mt-2", readableTextWidthClass)}>{description}</p>
        ) : null}
        {descriptionStatus ? (
          <div className="mt-2 w-fit">
            <StatusBadge label={descriptionStatus.label} tone={descriptionStatus.tone} />
          </div>
        ) : null}
      </div>
      {meta || actions ? (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
          {meta ? <div className="min-w-0">{meta}</div> : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
