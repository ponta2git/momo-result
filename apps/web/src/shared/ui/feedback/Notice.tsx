import type { ReactNode } from "react";

type NoticeTone = "info" | "success" | "warning" | "danger";
type NoticePresentation = "contained" | "bare";

const toneClass = {
  info: "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  success:
    "border-[var(--color-success)]/50 bg-[var(--color-success)]/12 text-[var(--color-text-primary)]",
  warning:
    "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/22 text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 text-[var(--color-text-primary)]",
} as const satisfies Record<NoticeTone, string>;

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
      className={`momo-copy text-sm ${presentation === "contained" ? `rounded-[var(--radius-md)] border p-3 ${toneClass[tone]}` : "text-[var(--color-text-primary)]"}`}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      {title ? (
        <h3 className="momo-heading text-sm font-semibold text-[var(--color-text-primary)]">
          {title}
        </h3>
      ) : null}
      <div className={`min-w-0 text-pretty${title ? " mt-1" : ""}`}>{children}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
