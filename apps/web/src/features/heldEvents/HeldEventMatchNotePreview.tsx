import { useCallback, useId, useState } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function HeldEventMatchNotePreview({ body }: { body: string }) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const [collapsedOverflowing, setCollapsedOverflowing] = useState(false);

  const measureNote = useCallback(
    (element: HTMLParagraphElement | null) => {
      if (!element || expanded) return;
      const measure = () => {
        setCollapsedOverflowing(element.scrollHeight > element.clientHeight + 1);
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [expanded],
  );

  return (
    <div aria-label="試合メモ" className={readableTextWidthClass} role="note">
      {/* Changed text can overflow without changing the clamped height. Reattach its measurement. */}
      <p
        key={body}
        id={bodyId}
        ref={measureNote}
        className={cn(
          contentText.body,
          "whitespace-pre-wrap break-words text-pretty",
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
