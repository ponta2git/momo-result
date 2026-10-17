import { Undo2 } from "lucide-react";

import type { CumulativePair } from "@/features/seriesComparison/outlook/calculation";
import {
  compareOutlookOutcomes,
  outlookOutcome,
} from "@/features/seriesComparison/outlook/outlookOutcome";
import {
  useOutlookResultView,
  useOutlookToolbar,
} from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export function OutlookUndoButton() {
  const { view, undo } = useOutlookToolbar();
  return (
    <Button
      variant="quiet"
      size="sm"
      disabled={!view.canUndo}
      icon={<Undo2 aria-hidden="true" className="size-4" />}
      onClick={undo}
    >
      成績を1つ戻す
    </Button>
  );
}

export function OutlookComparisonControls() {
  const { view, pin, unpin } = useOutlookToolbar();
  return (
    <div className="grid min-w-0 gap-2" data-outlook-preserve-draft>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!view.canPin}
          aria-label={view.pinned ? "基準を更新（今の成績を基準にする）" : "この成績を残して比べる"}
          onClick={pin}
        >
          {view.pinned ? "基準を更新" : "残して比べる"}
        </Button>
        <span className={view.pinned ? undefined : "invisible"}>
          <Button size="sm" variant="quiet" disabled={!view.pinned} onClick={unpin}>
            比較を終える
          </Button>
        </span>
      </div>
      <p className={cn(contentText.supporting, "min-h-8")}>
        {view.pending ? "成績を残す前に、入力を反映するか取り消してください。" : null}
      </p>
    </div>
  );
}

/** The baseline stays fixed while the page's two existing inputs remain editable. */
export function OutlookScenarioComparison({
  cumulative,
  names,
}: {
  cumulative: CumulativePair;
  names: readonly [string, string];
}) {
  const view = useOutlookResultView();
  if (!view.pinnedFocus || !view.pinnedRival) return null;
  const beforePair = [view.pinnedFocus, view.pinnedRival] as const;
  const afterPair = [view.focus, view.rival] as const;
  const before = outlookOutcome(cumulative, beforePair, names);
  const after = outlookOutcome(cumulative, afterPair, names);
  return (
    <div className="grid min-w-0 gap-4">
      <p className={cn(contentText.primary, "min-h-14")} role="status">
        {compareOutlookOutcomes(cumulative, beforePair, afterPair, names)}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        {[
          { label: "残した成績", outcome: before },
          { label: "今の成績", outcome: after },
        ].map(({ label, outcome }) => (
          <div key={label} className="contents">
            <dt className={contentText.supporting}>{label}</dt>
            <dd className={contentText.body}>
              <span className="block min-h-10">{outcome.headline}</span>
              <span className={cn(contentText.supporting, "block min-h-4")}>{outcome.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
