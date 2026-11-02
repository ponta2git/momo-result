import type { ReactNode } from "react";

import { contentText } from "@/shared/ui/typography";

/**
 * Every capture section opens with the same heading and lead. A section-wide count or status
 * keeps its own slot at the top of the trailing edge, so a changing status never moves the
 * heading or the content below.
 */
export function OcrSectionHeading({
  id,
  lead,
  status,
  title,
}: {
  id: string;
  lead: ReactNode;
  status?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 id={id} className={contentText.heading}>
          {title}
        </h2>
        <p className={contentText.body}>{lead}</p>
      </div>
      {status ? <div className="shrink-0">{status}</div> : null}
    </div>
  );
}
