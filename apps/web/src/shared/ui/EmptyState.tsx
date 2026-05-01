import type { ReactNode } from "react";

type EmptyStateProps = {
  action?: ReactNode;
  className?: string | undefined;
  description?: ReactNode;
  title: ReactNode;
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function EmptyState({ action, className, description, title }: EmptyStateProps) {
  return (
    <div
      className={classNames(
        "border-line-soft bg-capture-black/24 rounded-2xl border px-4 py-5 text-sm",
        className,
      )}
    >
      <p className="text-ink-100 font-bold">{title}</p>
      {description ? <div className="text-ink-300 mt-1 text-pretty">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
