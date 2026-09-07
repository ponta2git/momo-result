import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

type SkeletonProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "span" | undefined;
};

export function Skeleton({ as: Component = "div", className, ...props }: SkeletonProps) {
  return (
    <Component
      aria-hidden="true"
      className={cn(
        "rounded-xs bg-[var(--color-surface-selected)] motion-safe:animate-pulse motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
