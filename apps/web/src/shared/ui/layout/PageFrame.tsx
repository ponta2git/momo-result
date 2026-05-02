import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

export function PageFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <main
      className={cn(
        "mx-auto flex min-h-dvh w-full max-w-[75rem] flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6",
        className,
      )}
      {...props}
    />
  );
}
