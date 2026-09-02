import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

import { DecorativeActionIcon, iconActionClassName } from "@/shared/ui/actions/actionRecipes";
import type { IconActionSize, IconActionVariant } from "@/shared/ui/actions/actionRecipes";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

export type IconLinkProps = Omit<LinkProps, "children" | "className" | "style"> & {
  "aria-label": string;
  disabled?: boolean | undefined;
  icon: ReactNode;
  size?: IconActionSize | undefined;
  tooltip?: ReactNode | undefined;
  variant?: Exclude<IconActionVariant, "danger"> | undefined;
};

/** A navigation-only icon control with one accessible name and a mobile-safe hit target. */
export function IconLink({
  "aria-label": ariaLabel,
  disabled = false,
  icon,
  size = "md",
  tooltip,
  variant = "secondary",
  ...props
}: IconLinkProps) {
  const classes = iconActionClassName({ disabled, size, variant });
  const content = <DecorativeActionIcon iconOnly>{icon}</DecorativeActionIcon>;
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
