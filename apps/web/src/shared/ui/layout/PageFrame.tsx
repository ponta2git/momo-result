import type { ComponentPropsWithRef } from "react";

import { cn } from "@/shared/ui/cn";

/**
 * Page widths named by the content need they serve.
 * - readable: the whole page is a short form, message, or prose read at the readable measure.
 * - default: lists, management, capture, and single-column entry with no special width need.
 * - analysis: side-by-side comparison of players or metrics, and detail analysis.
 * - workspace: a source image and its editor shown side by side.
 */
export type PageFrameWidth = "analysis" | "default" | "readable" | "workspace";

type PageFrameProps = ComponentPropsWithRef<"div"> & {
  width?: PageFrameWidth;
};

export const pageFrameWidthClass = {
  analysis: "max-w-page-analysis",
  default: "max-w-page-default",
  readable: "max-w-readable",
  workspace: "max-w-page-workspace",
} as const satisfies Record<PageFrameWidth, string>;

/** Keeps page-level siblings on one rhythm across ready, loading, and terminal states. */
export const pageFrameSiblingGapClass = "gap-6";

/** Keeps viewport-level content and navigation on the same responsive inline gutter. */
export const pageViewportGutterClass = "px-3 sm:px-4";

export function PageFrame({ className, width = "default", ...props }: PageFrameProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-full min-w-0 flex-col",
        pageFrameSiblingGapClass,
        pageFrameWidthClass[width],
        className,
      )}
      {...props}
    />
  );
}
