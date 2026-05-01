import type { ReactNode } from "react";

type NoticeTone = "info" | "success" | "warning" | "danger";

type NoticeProps = {
  children: ReactNode;
  className?: string | undefined;
  role?: "alert" | "status" | "note" | undefined;
  title?: ReactNode;
  tone?: NoticeTone;
};

const toneClass: Record<NoticeTone, string> = {
  info: "border-line-soft bg-capture-black/30 text-ink-200",
  success: "border-route-green/40 bg-route-green/12 text-emerald-50",
  warning: "border-rail-gold/30 bg-rail-gold/10 text-yellow-50",
  danger: "border-red-300/30 bg-red-950/40 text-red-50",
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Notice({ children, className, role, title, tone = "info" }: NoticeProps) {
  return (
    <div
      className={classNames("rounded-3xl border p-4 text-sm", toneClass[tone], className)}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      {title ? <p className="text-ink-100 font-bold">{title}</p> : null}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}
