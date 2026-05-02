import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-[var(--radius-xs)] bg-[var(--color-surface-selected)] motion-safe:animate-pulse motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
