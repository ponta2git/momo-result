import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

type PageFrameProps = HTMLAttributes<HTMLDivElement> & {
  width?: "narrow" | "standard" | "wide" | "workspace";
};

const widthClass = {
  narrow: "max-w-[48rem]",
  standard: "max-w-[75rem]",
  wide: "max-w-[82rem]",
  workspace: "max-w-[90rem]",
} as const satisfies Record<NonNullable<PageFrameProps["width"]>, string>;

export function PageFrame({ className, width = "standard", ...props }: PageFrameProps) {
  return (
    <div
      className={cn("mx-auto flex w-full flex-col gap-4", widthClass[width], className)}
      {...props}
    />
  );
}
