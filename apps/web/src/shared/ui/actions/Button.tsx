import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/shared/ui/cn";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border-[var(--color-action)] bg-[var(--color-action)] text-white hover:opacity-90 active:opacity-95 focus-visible:outline-[var(--color-action)]",
  secondary:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)]",
  quiet:
    "border-transparent bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:opacity-90 active:opacity-95 focus-visible:outline-[var(--color-danger)]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-sm",
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-11 px-5 py-2.5 text-base",
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  icon?: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  size?: ButtonSize;
  type?: "button" | "submit" | "reset";
  variant?: ButtonVariant;
};

export const Button = forwardRef(function Button(
  {
    children,
    className,
    disabled,
    icon,
    pending = false,
    pendingLabel,
    size = "md",
    type = "button",
    variant = "primary",
    ...props
  }: ButtonProps,
  ref: Ref<HTMLButtonElement>,
) {
  const isDisabled = disabled || pending;

  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex w-auto min-w-0 items-center justify-center gap-2 rounded-[var(--radius-sm)] border font-semibold whitespace-normal break-words transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
        sizeClass[size],
        variantClass[variant],
        className,
      )}
      disabled={isDisabled}
      type={type}
      {...props}
    >
      {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : icon}
      <span>{pending ? (pendingLabel ?? children) : children}</span>
    </button>
  );
});
