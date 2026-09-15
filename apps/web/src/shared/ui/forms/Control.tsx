import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/shared/ui/cn";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";

export type {
  ControlDensity,
  ControlHeight,
  ControlTextAlign,
  ControlTone,
} from "@/shared/ui/forms/controlPresentation";
import { controlClassName } from "@/shared/ui/forms/controlPresentation";
import type { ControlPresentationProps } from "@/shared/ui/forms/controlPresentation";

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
  const surfaceRef = useSurfaceFeedback(props.ref);
  return (
    <input
      {...props}
      ref={surfaceRef}
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
  multiple,
  size,
  textAlign = "start",
  tone = "default",
  ...props
}: SelectControlProps) {
  const surfaceRef = useSurfaceFeedback(props.ref);
  const showIndicator = !multiple && (size === undefined || size <= 1);

  return (
    <div className="relative min-w-0">
      <select
        {...props}
        ref={surfaceRef}
        multiple={multiple}
        size={size}
        aria-invalid={invalid || undefined}
        className={cn(
          controlClassName(
            { controlHeight, density, invalid, textAlign, tone },
            showIndicator ? "selection" : "entry",
          ),
          "peer block",
          showIndicator ? "appearance-none forced-colors:appearance-auto" : "",
          showIndicator ? (density === "compact" ? "pr-8" : "pr-10") : "",
        )}
      />
      {showIndicator ? (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-secondary)] peer-disabled:text-[var(--color-text-muted)] peer-disabled:opacity-70 forced-colors:hidden",
            density === "compact" ? "right-2" : "right-3",
          )}
        />
      ) : null}
    </div>
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
  const surfaceRef = useSurfaceFeedback(props.ref);
  return (
    <textarea
      {...props}
      ref={surfaceRef}
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
