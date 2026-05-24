import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";
import { MomoStationIllustration } from "@/shared/ui/feedback/MomoStationIllustration";

type MomoStationBackdropProps = HTMLAttributes<HTMLDivElement> & {
  size?: "md" | "lg";
  tone?: "empty" | "ready";
};

const sizeClass = {
  md: "w-56",
  lg: "w-64",
} as const;

export function MomoStationBackdrop({
  className,
  size = "md",
  tone = "empty",
  ...props
}: MomoStationBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute right-4 bottom-2 z-0 hidden aspect-[180/132] opacity-[0.22] sm:block",
        sizeClass[size],
        className,
      )}
      data-illustration-backdrop="momo-station"
      {...props}
    >
      <MomoStationIllustration className="h-full w-full max-w-none" tone={tone} />
    </div>
  );
}
