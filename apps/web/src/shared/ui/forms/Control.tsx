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

/** Input kinds that share the editable text/date control's presentation and focus behavior. */
type InputControlType =
  | "date"
  | "datetime-local"
  | "email"
  | "month"
  | "number"
  | "password"
  | "search"
  | "tel"
  | "text"
  | "time"
  | "url"
  | "week";

export type InputControlProps = ControlPresentationProps & {
  type?: InputControlType | undefined;
} & Omit<ComponentPropsWithRef<"input">, "aria-invalid" | "className" | "style" | "type">;

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
