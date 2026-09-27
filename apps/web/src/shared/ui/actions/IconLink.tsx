import type { ReactNode, Ref } from "react";

import { ActionLink } from "@/shared/ui/actions/ActionLink";
import type { ActionLinkProps } from "@/shared/ui/actions/ActionLink";
import { DecorativeActionIcon, iconActionClassName } from "@/shared/ui/actions/actionRecipes";
import type { IconActionSize, IconActionVariant } from "@/shared/ui/actions/actionRecipes";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

export type IconLinkProps = Omit<
  Extract<ActionLinkProps, { to: unknown }>,
  "children" | "className" | "pending" | "style"
> & {
  "aria-label": string;
  disabled?: boolean | undefined;
  icon: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
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
  const control = (
    <ActionLink {...props} aria-label={ariaLabel} className={classes} disabled={disabled}>
      {content}
    </ActionLink>
  );

  return tooltip ? <Tooltip content={tooltip}>{control}</Tooltip> : control;
}
