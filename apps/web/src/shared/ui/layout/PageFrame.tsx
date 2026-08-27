import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

export type PageFrameWidth = "narrow" | "standard" | "wide" | "workspace";

type PageFrameProps = HTMLAttributes<HTMLDivElement> & {
  width?: PageFrameWidth;
};

export const pageFrameWidthClass = {
  narrow: "max-w-[56rem]",
  standard: "max-w-[96rem]",
  wide: "max-w-[108rem]",
  workspace: "max-w-[120rem]",
} as const satisfies Record<PageFrameWidth, string>;

/** Keeps viewport-level content and navigation on the same responsive inline gutter. */
export const pageViewportGutterClass = "px-3 sm:px-4";

export function PageFrame({ className, width = "standard", ...props }: PageFrameProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-full min-w-0 flex-col gap-6",
        pageFrameWidthClass[width],
        className,
      )}
      {...props}
    />
  );
}
