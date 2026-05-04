import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/shared/ui/cn";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg";
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
  sm: "min-h-9 px-3 py-1.5 text-sm",
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-11 px-5 py-2.5 text-base",
} as const satisfies Record<ButtonSize, string>;

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  icon?: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  size?: ButtonSize;
  type?: ButtonType;
  variant?: ButtonVariant;
};

export function Button({
  children,
  className,
  disabled,
  icon,
  pending = false,
  pendingLabel,
  ref,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const isDisabled = disabled || pending;
  const buttonClassName = cn(
    "inline-flex w-auto min-w-0 items-center justify-center gap-2 rounded-[var(--radius-sm)] border font-semibold whitespace-normal break-words transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
    sizeClass[size],
    variantClass[variant],
    className,
  );
  const inner = (
    <>
      {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : icon}
      <span>{pending ? (pendingLabel ?? children) : children}</span>
    </>
  );

  // 静的解析 (react/button-has-type) はリテラル `type` のみ受け入れるため、
  // `ButtonType` の判別を JSX 側で行いリテラルとして埋める。
  if (type === "submit") {
    return (
      <button
        ref={ref}
        className={buttonClassName}
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
        className={buttonClassName}
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
      className={buttonClassName}
      disabled={isDisabled}
      type="button"
      {...props}
    >
      {inner}
    </button>
  );
}
