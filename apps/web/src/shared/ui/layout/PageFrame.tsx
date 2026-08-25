import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

export type PageFrameWidth = "narrow" | "standard" | "wide" | "workspace";

type PageFrameProps = HTMLAttributes<HTMLDivElement> & {
  width?: PageFrameWidth;
};

export const pageFrameWidthClass = {
  narrow: "max-w-[48rem]",
  standard: "max-w-[75rem]",
  wide: "max-w-[82rem]",
  workspace: "max-w-[90rem]",
} as const satisfies Record<PageFrameWidth, string>;

export function PageFrame({ className, width = "standard", ...props }: PageFrameProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-full min-w-0 flex-col gap-4",
        pageFrameWidthClass[width],
        className,
      )}
      {...props}
    />
  );
}
