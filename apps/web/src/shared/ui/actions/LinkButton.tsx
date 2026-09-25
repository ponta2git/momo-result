import type { ReactNode } from "react";

import { ActionLink } from "@/shared/ui/actions/ActionLink";
import type { ActionLinkProps } from "@/shared/ui/actions/ActionLink";
import { buttonClassName } from "@/shared/ui/actions/actionRecipes";
import type { ButtonSize, ButtonVariant } from "@/shared/ui/actions/actionRecipes";
import { PendingActionContent } from "@/shared/ui/actions/PendingActionContent";

type LinkButtonAppearance = {
  "aria-busy"?: never;
  children: ReactNode;
  icon?: ReactNode;
  pending?: boolean | undefined;
  pendingLabel?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

type WithoutVisualOverride<Props> = Props extends unknown
  ? Omit<Props, "aria-busy" | "children" | "className" | "style"> & LinkButtonAppearance
  : never;

export type LinkButtonProps = WithoutVisualOverride<ActionLinkProps>;

/** Router or document navigation with the shared text-action and pending contract. */
export function LinkButton({
  children,
  disabled = false,
  icon,
  pending = false,
  pendingLabel,
  size = "md",
  variant = "primary",
  ...props
}: LinkButtonProps) {
  const unavailable = disabled || pending;

  return (
    <ActionLink
      {...props}
      aria-busy={pending || undefined}
      className={buttonClassName({ disabled: unavailable, size, variant })}
      disabled={disabled}
      pending={pending}
    >
      <PendingActionContent icon={icon} pending={pending} pendingLabel={pendingLabel}>
        {children}
      </PendingActionContent>
    </ActionLink>
  );
}
