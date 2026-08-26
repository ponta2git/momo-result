import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

import type { IconButtonSize, IconButtonVariant } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

const sizeClass = {
  sm: "size-11 sm:size-10",
  md: "size-11",
  lg: "size-12",
} as const satisfies Record<IconButtonSize, string>;

const variantClass = {
  secondary:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
  quiet:
    "border-transparent bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
} as const satisfies Record<Exclude<IconButtonVariant, "danger">, string>;

export type IconLinkProps = Omit<LinkProps, "children" | "className"> & {
  "aria-label": string;
  className?: string | undefined;
  disabled?: boolean | undefined;
  icon: ReactNode;
  size?: IconButtonSize | undefined;
  tooltip?: ReactNode | undefined;
  variant?: Exclude<IconButtonVariant, "danger"> | undefined;
};

/** A navigation-only icon control with one accessible name and a mobile-safe hit target. */
export function IconLink({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  icon,
  size = "md",
  tooltip,
  variant = "secondary",
  ...props
}: IconLinkProps) {
  const classes = cn(
    "momo-pressable inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
    sizeClass[size],
    variantClass[variant],
    disabled ? "cursor-not-allowed opacity-60" : "",
    className,
  );
  const content = (
    <span aria-hidden="true" className="inline-flex items-center justify-center [&_svg]:size-5">
      {icon}
    </span>
  );
  const control = disabled ? (
    <span aria-disabled="true" aria-label={ariaLabel} className={classes} role="link">
      {content}
    </span>
  ) : (
    <Link aria-label={ariaLabel} className={classes} {...props}>
      {content}
    </Link>
  );

  return tooltip ? <Tooltip content={tooltip}>{control}</Tooltip> : control;
}
