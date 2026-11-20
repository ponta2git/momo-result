import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

type NoticeTone = "info" | "success" | "warning" | "danger";
type NoticePresentation = "contained" | "nested" | "bare";

const toneClass = {
  info: "border-border bg-surface-subtle",
  success: "border-tone-success-border bg-tone-success-surface",
  warning: "border-tone-warning-border bg-tone-warning-surface",
  danger: "border-tone-danger-border bg-tone-danger-surface",
} as const satisfies Record<NoticeTone, string>;

const boundedPresentationClass = {
  contained: "rounded-md border p-3",
  nested: "rounded-sm border p-3",
} as const satisfies Record<Exclude<NoticePresentation, "bare">, string>;

export type NoticeProps = {
  action?: ReactNode;
  children: ReactNode;
  presentation?: NoticePresentation;
  role?: "alert" | "note" | "status";
  title?: ReactNode;
  tone?: NoticeTone;
};

export function Notice({
  action,
  children,
  presentation = "contained",
  role,
  title,
  tone = "info",
}: NoticeProps) {
  return (
    <section
      className={cn(
        contentText.body,
        presentation === "bare" ? "" : cn(boundedPresentationClass[presentation], toneClass[tone]),
      )}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      {title ? <h3 className={cn(contentText.heading, readableTextWidthClass)}>{title}</h3> : null}
      <div className={cn("min-w-0 text-pretty", readableTextWidthClass, title ? "mt-1" : "")}>
        {children}
      </div>
      {action ? <div className="mt-3">{action}</div> : null}
    </section>
  );
}
