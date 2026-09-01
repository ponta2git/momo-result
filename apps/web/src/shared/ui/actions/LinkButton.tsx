import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

import { buttonClassName, DecorativeActionIcon } from "@/shared/ui/actions/actionRecipes";
import type { ButtonSize, ButtonVariant } from "@/shared/ui/actions/actionRecipes";

export type LinkButtonProps = Omit<LinkProps, "children" | "className" | "style"> & {
  children: ReactNode;
  disabled?: boolean | undefined;
  icon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

/** A navigation link presented with the shared text-action recipe. */
export function LinkButton({
  children,
  disabled = false,
  icon,
  size = "md",
  variant = "primary",
  ...props
}: LinkButtonProps) {
  const content = (
    <>
      {icon ? <DecorativeActionIcon>{icon}</DecorativeActionIcon> : null}
      <span>{children}</span>
    </>
  );

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={buttonClassName({
          disabled: true,
          size,
          variant,
        })}
        role="link"
      >
        {content}
      </span>
    );
  }

  return (
    <Link className={buttonClassName({ size, variant })} {...props}>
      {content}
    </Link>
  );
}
