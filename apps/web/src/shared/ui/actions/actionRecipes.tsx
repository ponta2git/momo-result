/** Owns shared visual recipes and decorative-icon semantics for action primitives. */
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

export type ButtonSize = "sm" | "md" | "lg";
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "dangerQuiet";
export type IconActionSize = "sm" | "md" | "lg";
export type IconActionVariant = "secondary" | "quiet" | "danger";

const actionBaseClass = "inline-flex items-center justify-center rounded-sm border";

const surfaceVariantClass = {
  secondary:
    "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]",
  quiet:
    "border-transparent bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-danger)] bg-[var(--color-danger)] text-[var(--color-text-inverse)] hover:opacity-90 active:opacity-95",
} as const satisfies Record<IconActionVariant, string>;

const buttonVariantClass = {
  primary:
    "border-[var(--color-action)] bg-[var(--color-action)] text-[var(--color-text-inverse)] hover:opacity-90 active:opacity-95 focus-visible:outline-[var(--color-action)]",
  secondary: cn(surfaceVariantClass.secondary, "text-[var(--color-text-primary)]"),
  quiet: surfaceVariantClass.quiet,
  danger: cn(surfaceVariantClass.danger, "focus-visible:outline-[var(--color-danger)]"),
  dangerQuiet:
    "border-transparent bg-transparent text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-danger)] focus-visible:outline-[var(--color-danger)]",
} as const satisfies Record<ButtonVariant, string>;

const iconActionVariantClass = {
  secondary: cn(
    surfaceVariantClass.secondary,
    "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
  ),
  quiet: surfaceVariantClass.quiet,
  danger: surfaceVariantClass.danger,
} as const satisfies Record<IconActionVariant, string>;

const buttonSizeClass = {
  sm: "min-h-11 px-3 py-2 text-sm pointer-fine:min-h-9 pointer-fine:py-1",
  md: "min-h-11 px-4 py-2 text-sm pointer-fine:min-h-10",
  lg: "min-h-11 px-5 py-3 text-base",
} as const satisfies Record<ButtonSize, string>;

const iconActionSizeClass = {
  sm: "size-11",
  md: "size-11",
  lg: "size-12",
} as const satisfies Record<IconActionSize, string>;

/** Resolves the stable text-action recipe without exposing its visual boundary to consumers. */
export function buttonClassName({
  disabled = false,
  size = "md",
  variant = "primary",
}: {
  disabled?: boolean | undefined;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
}) {
  return cn(
    actionBaseClass,
    "min-w-0 gap-2 font-semibold whitespace-normal break-words disabled:cursor-not-allowed disabled:opacity-60",
    buttonSizeClass[size],
    buttonVariantClass[variant],
    disabled && "cursor-not-allowed opacity-60",
  );
}

/** Resolves the stable square icon-action recipe for button and link semantics. */
export function iconActionClassName({
  disabled = false,
  size = "md",
  variant = "secondary",
}: {
  disabled?: boolean | undefined;
  size?: IconActionSize | undefined;
  variant?: IconActionVariant | undefined;
}) {
  return cn(
    actionBaseClass,
    "shrink-0 disabled:cursor-not-allowed disabled:opacity-60",
    iconActionSizeClass[size],
    iconActionVariantClass[variant],
    disabled && "cursor-not-allowed opacity-60",
  );
}

/** Keeps supplied graphics decorative so the action owns one stable accessible name. */
export function DecorativeActionIcon({
  children,
  iconOnly = false,
}: {
  children: ReactNode;
  iconOnly?: boolean | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        iconOnly ? "[&_svg]:size-5" : "[&_svg]:size-4",
      )}
    >
      {children}
    </span>
  );
}
