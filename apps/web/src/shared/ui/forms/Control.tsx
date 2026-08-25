import type { ComponentPropsWithRef } from "react";

import { cn } from "@/shared/ui/cn";

export type ControlDensity = "compact" | "default";
export type ControlTextAlign = "center" | "end" | "start";
export type ControlTone = "action" | "default" | "review" | "success" | "warning";

type ControlPresentationProps = {
  density?: ControlDensity | undefined;
  invalid?: boolean | undefined;
  textAlign?: ControlTextAlign | undefined;
  tone?: ControlTone | undefined;
};

const densityClass = {
  compact: "px-2",
  default: "px-3",
} as const satisfies Record<ControlDensity, string>;

const textAlignClass = {
  center: "text-center",
  end: "text-right",
  start: "text-left",
} as const satisfies Record<ControlTextAlign, string>;

const toneClass = {
  action: "border-[var(--color-action)]/55 bg-[var(--color-action)]/10",
  default: "",
  review: "border-[var(--color-review)]/75 bg-[var(--color-review)]/14",
  success: "border-[var(--color-success)]/55 bg-[var(--color-success)]/12",
  warning: "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18",
} as const satisfies Record<ControlTone, string>;

const baseControlClass =
  "min-h-11 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-base leading-6 text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-subtle)] disabled:text-[var(--color-text-muted)] disabled:opacity-70 sm:min-h-10 sm:text-sm";
const invalidControlClass = "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10";

type ResolvedControlPresentation = {
  density: ControlDensity;
  invalid: boolean;
  textAlign: ControlTextAlign;
  tone: ControlTone;
};

function controlClassName({
  className,
  density,
  invalid,
  textAlign,
  tone,
}: ResolvedControlPresentation & { className?: string | undefined }) {
  return cn(
    baseControlClass,
    densityClass[density],
    textAlignClass[textAlign],
    invalid ? invalidControlClass : toneClass[tone],
    className,
  );
}

export type InputControlProps = ControlPresentationProps &
  Omit<ComponentPropsWithRef<"input">, "aria-invalid">;

/** Owns the shared presentation and boolean invalid contract for a native input. */
export function InputControl({
  className,
  density = "default",
  invalid = false,
  textAlign = "start",
  tone = "default",
  ...props
}: InputControlProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={controlClassName({ className, density, invalid, textAlign, tone })}
    />
  );
}

export type SelectControlProps = ControlPresentationProps &
  Omit<ComponentPropsWithRef<"select">, "aria-invalid">;

/** Owns the shared presentation and boolean invalid contract for a native select. */
export function SelectControl({
  className,
  density = "default",
  invalid = false,
  textAlign = "start",
  tone = "default",
  ...props
}: SelectControlProps) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={controlClassName({ className, density, invalid, textAlign, tone })}
    />
  );
}
