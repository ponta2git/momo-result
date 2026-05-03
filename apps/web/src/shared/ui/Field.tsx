import type { ReactNode } from "react";

type FieldProps = {
  label: string;
  htmlFor: string;
  children: ReactNode;
  error?: string | undefined;
  hint?: string | undefined;
};

export function Field({ label, htmlFor, children, error, hint }: FieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-[var(--color-text-primary)]">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{hint}</p> : null}
      {error ? (
        <p className="mt-1 text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
