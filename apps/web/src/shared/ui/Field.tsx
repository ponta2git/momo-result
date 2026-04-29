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
      <label htmlFor={htmlFor} className="text-sm font-bold text-ink-100">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-1 text-xs text-ink-300">{hint}</p> : null}
      {error ? (
        <p className="mt-1 text-sm text-red-200" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
