import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { pageViewportGutterClass } from "@/shared/ui/layout/PageFrame";
import { SkipLink } from "@/shared/ui/layout/SkipLink";

type AppPageCanvasProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  "onClickCapture" | "onFocusCapture" | "onPointerOverCapture"
> & {
  children: ReactNode;
  navigation: ReactNode;
};

/** Owns the application nav, main landmark, viewport gutter, and page-block breathing room. */
export function AppPageCanvas({ children, navigation, ...eventHandlers }: AppPageCanvasProps) {
  return (
    <>
      <SkipLink />
      <div className="flex min-h-dvh flex-col" {...eventHandlers}>
        {navigation}
        <main
          className={cn(
            "mx-auto flex w-full flex-1 flex-col py-4 sm:py-6",
            pageViewportGutterClass,
          )}
          id="main-content"
        >
          {children}
        </main>
      </div>
    </>
  );
}
