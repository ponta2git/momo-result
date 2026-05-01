import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type PageHeaderProps = {
  actions?: ReactNode;
  backLink?: { label: string; to: string } | undefined;
  className?: string | undefined;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function PageHeader({
  actions,
  backLink,
  className,
  description,
  eyebrow,
  meta,
  title,
}: PageHeaderProps) {
  return (
    <header
      className={classNames(
        "flex flex-col gap-3 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {backLink ? (
          <Link to={backLink.to} className="text-rail-gold text-sm hover:underline">
            {backLink.label}
          </Link>
        ) : null}
        {eyebrow ? (
          <p className="text-rail-gold mt-4 text-xs font-bold uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="text-ink-100 mt-1 text-3xl font-black text-balance">{title}</h1>
        {description ? (
          <div className="text-ink-300 mt-2 max-w-2xl text-sm leading-6 text-pretty">
            {description}
          </div>
        ) : null}
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
