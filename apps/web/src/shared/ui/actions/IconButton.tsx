import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/shared/ui/cn";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

type IconButtonSize = "sm" | "md" | "lg";
type IconButtonVariant = "secondary" | "quiet" | "danger";

const sizeClass = {
  sm: "size-10",
  md: "size-11",
  lg: "size-12",
} as const satisfies Record<IconButtonSize, string>;

const variantClass = {
  secondary:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]",
  quiet:
    "border-transparent bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:opacity-90 active:opacity-95",
} as const satisfies Record<IconButtonVariant, string>;

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  "aria-label": string;
  icon: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  size?: IconButtonSize;
  tooltip?: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: IconButtonVariant;
};

export function IconButton({
  "aria-label": ariaLabel,
  className,
  icon,
  ref,
  size = "md",
  tooltip,
  type = "button",
  variant = "secondary",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
        sizeClass[size],
        variantClass[variant],
        className,
      )}
      // oxlint-disable-next-line react/button-has-type -- type is constrained to the button/submit/reset literal union with a default of "button".
      type={type}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex items-center justify-center [&_svg]:size-5">
        {icon}
      </span>
    </button>
  );

  if (!tooltip) {
    return button;
  }

  return <Tooltip content={tooltip}>{button}</Tooltip>;
}
