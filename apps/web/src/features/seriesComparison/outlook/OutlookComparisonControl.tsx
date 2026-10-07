import { useId } from "react";

import { distributionMean } from "@/features/seriesComparison/model/outlook";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import { canPinOutlook, pinOutlook } from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { orderFixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { contentText } from "@/shared/ui/typography";

export function OutlookComparisonControl({
  session,
  names,
  memberIds,
  change,
}: {
  session: OutlookSession;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const descriptionId = useId();
  const pending =
    Boolean(session.gesture) ||
    session.entries.some((entry) => entry.meanDraft !== undefined || entry.error !== undefined);
  const canPin = canPinOutlook(session);
  const pinned = session.pinned;
  const heldSummary = pinned
    ? orderFixedMembers(memberIds.map((memberId, role) => ({ memberId, role: role as 0 | 1 })))
        .map(
          ({ role }) =>
            `${names[role]} ${outlookAverage(distributionMean(pinned[role].distribution))}位`,
        )
        .join("、")
    : null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2" data-outlook-preserve-draft>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={session.pinned && !canPin ? "quiet" : "secondary"}
          aria-disabled={!canPin || undefined}
          aria-describedby={descriptionId}
          onClick={() => change(pinOutlook)}
        >
          {session.pinned ? "保持を更新" : "今の成績を保持"}
        </Button>
        {session.pinned ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => change((current) => ({ ...current, pinned: undefined }))}
          >
            保持を解除
          </Button>
        ) : null}
      </div>
      <p id={descriptionId} className={contentText.supporting}>
        {pending
          ? "入力を確定すると保持できます。"
          : session.pinned && !canPin
            ? "表示中の成績を保持しています。"
            : "2人の成績を同じ戦数で比べます。"}
      </p>
      {heldSummary ? (
        <p role="status" className={contentText.body}>
          保持：{heldSummary}
        </p>
      ) : null}
    </div>
  );
}
