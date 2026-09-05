import { useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";

export function HeldEventMatchNotePreview({ body }: { body: string }) {
  const bodyId = useId();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsedOverflowing, setCollapsedOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => {
      if (expanded) return;
      setCollapsedOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // Text changes can alter scrollHeight without resizing the clamped element.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [body, expanded]);

  return (
    <div>
      <p className="text-xs font-semibold text-[var(--color-text-secondary)]">試合メモ</p>
      <p
        id={bodyId}
        ref={textRef}
        className={cn(
          "mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text-primary)]",
          !expanded && "line-clamp-3",
        )}
      >
        {body}
      </p>
      {collapsedOverflowing || expanded ? (
        <div className="mt-1">
          <Button
            aria-controls={bodyId}
            aria-expanded={expanded}
            size="sm"
            variant="quiet"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "メモを閉じる" : "メモ全文を表示"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
