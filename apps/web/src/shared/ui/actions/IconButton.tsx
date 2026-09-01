import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { useFormStatus } from "react-dom";

import { DecorativeActionIcon, iconActionClassName } from "@/shared/ui/actions/actionRecipes";
import type { IconActionSize, IconActionVariant } from "@/shared/ui/actions/actionRecipes";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

export type IconButtonSize = IconActionSize;
export type IconButtonVariant = IconActionVariant;

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-busy" | "aria-label" | "children" | "className" | "disabled" | "style" | "type"
> & {
  "aria-busy"?: never;
  "aria-label": string;
  disabled?: boolean | undefined;
  icon: ReactNode;
  pending?: boolean | undefined;
  pendingLabel?: string | undefined;
  ref?: Ref<HTMLButtonElement>;
  size?: IconButtonSize;
  tooltip?: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: IconButtonVariant;
};

/** An icon-only button that owns its accessible name, pending state, and touch target. */
export function IconButton({
  "aria-label": ariaLabel,
  disabled,
  icon,
  pending,
  pendingLabel,
  ref,
  size = "md",
  tooltip,
  type = "button",
  variant = "secondary",
  ...props
}: IconButtonProps) {
  const formStatus = useFormStatus();
  const actualPending = pending ?? (type === "submit" && formStatus.pending);
  const actualLabel = actualPending ? (pendingLabel ?? ariaLabel) : ariaLabel;
  const button = (
    <button
      {...props}
      ref={ref}
      aria-busy={actualPending || undefined}
      aria-label={actualLabel}
      className={iconActionClassName({ size, variant })}
      disabled={disabled || actualPending}
      // oxlint-disable-next-line react/button-has-type -- the public type is a closed literal union with a safe "button" default.
      type={type}
    >
      <DecorativeActionIcon iconOnly>{actualPending ? <SpinnerIcon /> : icon}</DecorativeActionIcon>
    </button>
  );

  if (!tooltip) {
    return button;
  }

  return <Tooltip content={actualPending ? (pendingLabel ?? tooltip) : tooltip}>{button}</Tooltip>;
}
