import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

type NoticeTone = "info" | "success" | "warning" | "danger";
type NoticePresentation = "contained" | "nested" | "bare";

const toneClass = {
  info: "border-[var(--color-border)] bg-[var(--color-surface-subtle)]",
  success: "border-[var(--color-tone-success-border)] bg-[var(--color-tone-success-surface)]",
  warning: "border-[var(--color-tone-warning-border)] bg-[var(--color-tone-warning-surface)]",
  danger: "border-[var(--color-tone-danger-border)] bg-[var(--color-tone-danger-surface)]",
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
