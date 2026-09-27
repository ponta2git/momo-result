import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

type TableScrollAreaProps = {
  children: ReactNode;
  maxHeight?: string | undefined;
} & ({ label: string; labelledBy?: never } | { label?: never; labelledBy: string });

/** One scroll boundary for ordinary and specialized native tables, focusable only on overflow. */
export function TableScrollArea({ children, label, labelledBy, maxHeight }: TableScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState({ horizontal: false, vertical: false });
  useLayoutEffect(() => {
    const area = scrollRef.current;
    if (!area) return;
    const measure = () => {
      const horizontal = area.scrollWidth > area.clientWidth;
      const vertical = area.scrollHeight > area.clientHeight;
      setOverflow((previous) =>
        previous.horizontal === horizontal && previous.vertical === vertical
          ? previous
          : { horizontal, vertical },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    if (area.firstElementChild) observer.observe(area.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const scrollable = overflow.horizontal || overflow.vertical;
  const namedScroll = label !== undefined || scrollable;
  return (
    <div className="min-w-0">
      {scrollable ? (
        <p className={cn(contentText.supporting, "mb-2")} id={hintId}>
          {overflow.horizontal && overflow.vertical
            ? "表は上下左右にスクロールできます。"
            : overflow.horizontal
              ? "表は左右にスクロールできます。"
              : "表は上下にスクロールできます。"}
        </p>
      ) : null}
      <div
        className={cn(
          "min-w-0 overflow-x-auto bg-[var(--color-surface)]",
          namedScroll && "relative isolate focus-visible:-outline-offset-2",
        )}
        ref={scrollRef}
        role={namedScroll ? "region" : undefined}
        aria-label={label}
        aria-labelledby={namedScroll ? labelledBy : undefined}
        aria-describedby={scrollable ? hintId : undefined}
        tabIndex={scrollable ? 0 : undefined}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
