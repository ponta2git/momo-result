import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

type MatchResultIllustrationProps = HTMLAttributes<HTMLDivElement>;

export function MatchResultIllustration({ className, ...props }: MatchResultIllustrationProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative aspect-square h-auto w-full max-w-40 shrink-0 overflow-visible",
        className,
      )}
      {...props}
    >
      <div className="absolute inset-[14%] rounded-full bg-[var(--color-warning)]/16 ring-1 ring-[var(--color-warning)]/35" />
      <div className="absolute inset-x-[8%] bottom-[10%] h-[18%] rounded-full bg-[var(--color-action)]/10 blur-[2px]" />
      <img
        alt=""
        className="relative h-full w-full object-contain"
        decoding="async"
        loading="lazy"
        src="/trophy.png"
      />
    </div>
  );
}
