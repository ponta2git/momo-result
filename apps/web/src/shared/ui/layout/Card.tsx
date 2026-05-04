import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-text-primary)] shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
