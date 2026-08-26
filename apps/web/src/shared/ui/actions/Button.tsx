import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { useFormStatus } from "react-dom";

import { buttonClassName, DecorativeActionIcon } from "@/shared/ui/actions/actionRecipes";
import type {
  ButtonSize as ActionButtonSize,
  ButtonVariant as ActionButtonVariant,
} from "@/shared/ui/actions/actionRecipes";

export { buttonClassName } from "@/shared/ui/actions/actionRecipes";
export type ButtonSize = ActionButtonSize;
export type ButtonVariant = ActionButtonVariant;
type ButtonType = "button" | "submit" | "reset";

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-busy" | "disabled" | "type"
> & {
  "aria-busy"?: never;
  disabled?: boolean | undefined;
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
      {actualPending || icon ? (
        <DecorativeActionIcon>
          {actualPending ? (
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            icon
          )}
        </DecorativeActionIcon>
      ) : null}
      <span>{actualPending ? (pendingLabel ?? children) : children}</span>
    </>
  );

  return (
    <button
      {...props}
      ref={ref}
      aria-busy={actualPending || undefined}
      className={buttonClasses}
      disabled={isDisabled}
      // oxlint-disable-next-line react/button-has-type -- ButtonType is a closed literal union with a safe "button" default; one branch avoids three drift-prone JSX copies.
      type={type}
    >
      {inner}
    </button>
  );
}
