import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";
import { MomoTransitIllustration } from "@/shared/ui/feedback/MomoTransitIllustration";

type MomoTransitBackdropProps = HTMLAttributes<HTMLDivElement> & {
  size?: "md" | "lg";
  tone?: "empty" | "ready";
};

const sizeClass = {
  md: "w-48",
  lg: "w-52",
} as const;

export function MomoTransitBackdrop({
  className,
  size = "md",
  tone = "empty",
  ...props
}: MomoTransitBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute right-4 bottom-3 z-0 hidden aspect-[180/116] opacity-[0.2] sm:block",
        sizeClass[size],
        className,
      )}
      data-illustration-backdrop="momo-transit"
      {...props}
    >
      <MomoTransitIllustration className="h-full w-full max-w-none" tone={tone} />
    </div>
  );
}
