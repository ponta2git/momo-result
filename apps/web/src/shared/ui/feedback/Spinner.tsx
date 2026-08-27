import { LoaderCircle } from "lucide-react";

import { cn } from "@/shared/ui/cn";

type SpinnerSize = "lg" | "md" | "sm";

const spinnerSizeClass = {
  lg: "size-5",
  md: "size-4",
  sm: "size-3.5",
} as const satisfies Record<SpinnerSize, string>;

type SpinnerIconProps = {
  className?: string | undefined;
  size?: SpinnerSize | undefined;
};

/** Decorative loading mark; the owning control or status provides loading semantics and text. */
export function SpinnerIcon({ className, size = "md" }: SpinnerIconProps) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={cn(
        "shrink-0 animate-spin motion-reduce:animate-none",
        spinnerSizeClass[size],
        className,
      )}
    />
  );
}
