import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type ControlTone = "default" | "ocrHighConfidence" | "manualReview";

const toneClass: Record<ControlTone, string> = {
  default:
    "border-line-soft bg-capture-black/45 text-ink-100 hover:border-white/18 disabled:opacity-55",
  ocrHighConfidence:
    "border-emerald-400/55 bg-emerald-400/10 text-ink-100 hover:border-emerald-400/70 disabled:opacity-55",
  manualReview:
    "border-rail-gold/55 bg-rail-gold/10 text-ink-100 hover:border-rail-gold/70 disabled:opacity-55",
};

export const fieldLabelClass = "text-ink-300 text-xs font-bold uppercase";
export const controlBaseClass =
  "w-full rounded-2xl border px-3 py-2 text-sm transition disabled:cursor-not-allowed";
export const roomyControlBaseClass =
  "w-full rounded-2xl border px-4 py-3 transition disabled:cursor-not-allowed";
export const numericControlClass = "text-right tabular-nums";
export const compactNumericControlClass = "text-center tabular-nums";

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function controlClassName({
  className,
  numeric = false,
  roomy = false,
  tone = "default",
}: {
  className?: string | undefined;
  numeric?: boolean;
  roomy?: boolean;
  tone?: ControlTone;
} = {}) {
  return classNames(
    roomy ? roomyControlBaseClass : controlBaseClass,
    toneClass[tone],
    numeric && numericControlClass,
    className,
  );
}

export function FieldLabel({
  children,
  className,
  htmlFor,
}: {
  children: ReactNode;
  className?: string | undefined;
  htmlFor?: string | undefined;
}) {
  return (
    <label className={classNames(fieldLabelClass, className)} htmlFor={htmlFor}>
      {children}
    </label>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  numeric?: boolean;
  roomy?: boolean;
  tone?: ControlTone;
};

export function TextInput({
  className,
  numeric = false,
  roomy = false,
  tone = "default",
  ...props
}: TextInputProps) {
  return (
    <input
      className={controlClassName({ className, numeric, roomy, tone })}
      inputMode={numeric ? "numeric" : props.inputMode}
      {...props}
    />
  );
}

type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement> & {
  roomy?: boolean;
  tone?: ControlTone;
};

export function SelectInput({
  className,
  roomy = false,
  tone = "default",
  ...props
}: SelectInputProps) {
  return <select className={controlClassName({ className, roomy, tone })} {...props} />;
}
