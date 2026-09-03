import type { ComponentPropsWithRef } from "react";

import { cn } from "@/shared/ui/cn";

export type ControlDensity = "compact" | "default";
export type ControlHeight = "default" | "touch";
export type ControlTextAlign = "center" | "end" | "start";
export type ControlTone = "action" | "default" | "review" | "success" | "warning";

type ControlPresentationProps = {
  controlHeight?: ControlHeight | undefined;
  density?: ControlDensity | undefined;
  invalid?: boolean | undefined;
  textAlign?: ControlTextAlign | undefined;
  tone?: ControlTone | undefined;
};

const densityClass = {
  compact: "px-2",
  default: "px-3",
} as const satisfies Record<ControlDensity, string>;

const heightClass = {
  default: "min-h-11 pointer-fine:min-h-10",
  touch: "min-h-11",
} as const satisfies Record<ControlHeight, string>;

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
  "w-full min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-base leading-6 text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-subtle)] disabled:text-[var(--color-text-muted)] disabled:opacity-70 sm:text-sm sm:leading-5";
const invalidControlClass = "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10";

type ResolvedControlPresentation = {
  controlHeight: ControlHeight;
  density: ControlDensity;
  invalid: boolean;
  textAlign: ControlTextAlign;
  tone: ControlTone;
};

function controlClassName({
  controlHeight,
  density,
  invalid,
  textAlign,
  tone,
}: ResolvedControlPresentation) {
  return cn(
    baseControlClass,
    heightClass[controlHeight],
    densityClass[density],
    textAlignClass[textAlign],
    invalid ? invalidControlClass : toneClass[tone],
  );
}

export type InputControlProps = ControlPresentationProps &
  Omit<ComponentPropsWithRef<"input">, "aria-invalid" | "className" | "style">;

/** Owns the shared presentation and boolean invalid contract for a native input. */
export function InputControl({
  controlHeight = "default",
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
      className={controlClassName({ controlHeight, density, invalid, textAlign, tone })}
    />
  );
}

export type SelectControlProps = ControlPresentationProps &
  Omit<ComponentPropsWithRef<"select">, "aria-invalid" | "className" | "style">;

/** Owns the shared presentation and boolean invalid contract for a native select. */
export function SelectControl({
  controlHeight = "default",
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
      className={controlClassName({ controlHeight, density, invalid, textAlign, tone })}
    />
  );
}

type TextareaMinHeight = "default" | "md" | "sm";

const textareaMinHeightClass = {
  default: "",
  md: "min-h-28",
  sm: "min-h-24",
} as const satisfies Record<TextareaMinHeight, string>;

export type TextareaControlProps = ControlPresentationProps & {
  minHeight?: TextareaMinHeight | undefined;
  placeholderTone?: "default" | "muted" | undefined;
  resize?: "fixed" | "vertical" | undefined;
  textFlow?: "default" | "relaxed" | undefined;
} & Omit<ComponentPropsWithRef<"textarea">, "aria-invalid" | "className" | "style">;

export function TextareaControl({
  controlHeight = "default",
  density = "default",
  invalid = false,
  minHeight = "default",
  placeholderTone = "default",
  resize = "fixed",
  textAlign = "start",
  textFlow = "default",
  tone = "default",
  ...props
}: TextareaControlProps) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(
        controlClassName({ controlHeight, density, invalid, textAlign, tone }),
        textareaMinHeightClass[minHeight],
        resize === "vertical" ? "resize-y" : "resize-none",
        textFlow === "relaxed" ? "leading-6" : "",
        placeholderTone === "muted" ? "placeholder:text-[var(--color-text-muted)]" : "",
      )}
    />
  );
}
