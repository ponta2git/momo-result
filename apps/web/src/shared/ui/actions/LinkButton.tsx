import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

import { buttonClassName } from "@/shared/ui/actions/Button";
import type { ButtonSize, ButtonVariant } from "@/shared/ui/actions/Button";

export type LinkButtonProps = Omit<LinkProps, "children" | "className"> & {
  children: ReactNode;
  className?: string | undefined;
  icon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function LinkButton({
  children,
  className,
  icon,
  size = "md",
  variant = "primary",
  ...props
}: LinkButtonProps) {
  return (
    <Link className={buttonClassName({ className, size, variant })} {...props}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
