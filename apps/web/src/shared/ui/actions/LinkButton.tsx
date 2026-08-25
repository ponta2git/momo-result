import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

import { buttonClassName } from "@/shared/ui/actions/Button";
import type { ButtonSize, ButtonVariant } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";

export type LinkButtonProps = Omit<LinkProps, "children" | "className"> & {
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
  icon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function LinkButton({
  children,
  className,
  disabled = false,
  icon,
  size = "md",
  variant = "primary",
  ...props
}: LinkButtonProps) {
  const content = (
    <>
      {icon}
      <span>{children}</span>
    </>
  );

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={buttonClassName({
          className: cn(className, "cursor-not-allowed opacity-60"),
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
    <Link className={buttonClassName({ className, size, variant })} {...props}>
      {content}
    </Link>
  );
}
