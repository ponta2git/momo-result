import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { useFormStatus } from "react-dom";

import { cn } from "@/shared/ui/cn";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
type ButtonType = "button" | "submit" | "reset";

const variantClass = {
  primary:
    "border-[var(--color-action)] bg-[var(--color-action)] text-white hover:opacity-90 active:opacity-95 focus-visible:outline-[var(--color-action)]",
  secondary:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)]",
  quiet:
    "border-transparent bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:opacity-90 active:opacity-95 focus-visible:outline-[var(--color-danger)]",
} as const satisfies Record<ButtonVariant, string>;

const sizeClass = {
  sm: "min-h-11 px-3 py-2 text-sm sm:min-h-9 sm:py-2",
  md: "min-h-11 px-4 py-2 text-sm sm:min-h-10",
  lg: "min-h-11 px-5 py-3 text-base",
} as const satisfies Record<ButtonSize, string>;

export function buttonClassName({
  className,
  size = "md",
  variant = "primary",
}: {
  className?: string | undefined;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
}) {
  return cn(
    "momo-pressable inline-flex w-auto min-w-0 items-center justify-center gap-2 rounded-[var(--radius-sm)] border leading-5 font-semibold whitespace-normal break-words disabled:cursor-not-allowed disabled:opacity-60",
    sizeClass[size],
    variantClass[variant],
    className,
  );
}

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  icon?: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  size?: ButtonSize;
  type?: ButtonType;
  variant?: ButtonVariant;
};

/**
 * Owns the button's semantic type and pending feedback. Submit buttons inherit the
 * nearest parent form's transition unless the caller supplies an explicit pending value.
 */
export function Button({
  children,
  className,
  disabled,
  icon,
  pending,
  pendingLabel,
  ref,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const formStatus = useFormStatus();
  const actualPending = pending ?? (type === "submit" && formStatus.pending);
  const isDisabled = disabled || actualPending;
  const buttonClasses = buttonClassName({ className, size, variant });
  const inner = (
    <>
      {actualPending ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none"
        />
      ) : (
        icon
      )}
      <span>{actualPending ? (pendingLabel ?? children) : children}</span>
    </>
  );

  // 静的解析 (react/button-has-type) はリテラル `type` のみ受け入れるため、
  // `ButtonType` の判別を JSX 側で行いリテラルとして埋める。
  if (type === "submit") {
    return (
      <button
        ref={ref}
        aria-busy={actualPending || undefined}
        className={buttonClasses}
        disabled={isDisabled}
        type="submit"
        {...props}
      >
        {inner}
      </button>
    );
  }
  if (type === "reset") {
    return (
      <button
        ref={ref}
        aria-busy={actualPending || undefined}
        className={buttonClasses}
        disabled={isDisabled}
        type="reset"
        {...props}
      >
        {inner}
      </button>
    );
  }
  return (
    <button
      ref={ref}
      aria-busy={actualPending || undefined}
      className={buttonClasses}
      disabled={isDisabled}
      type="button"
      {...props}
    >
      {inner}
    </button>
  );
}
