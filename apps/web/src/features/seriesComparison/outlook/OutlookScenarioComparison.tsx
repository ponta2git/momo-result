import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import {
  compareOutlookOutcomes,
  outlookOutcome,
} from "@/features/seriesComparison/outlook/outlookOutcome";
import { canPinOutlook, pinOutlook } from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export function OutlookComparisonControls({
  session,
  change,
}: {
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const pending = session.entries.some(
    (entry) => entry.meanDraft !== undefined || entry.error !== undefined,
  );
  return (
    <div className="grid min-w-0 gap-2" data-outlook-preserve-draft>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canPinOutlook(session)}
          aria-label={
            session.pinned ? "基準を更新（今の成績を基準にする）" : "この成績を残して比べる"
          }
          onClick={() => change(pinOutlook)}
        >
          {session.pinned ? "基準を更新" : "残して比べる"}
        </Button>
        <span className={session.pinned ? undefined : "invisible"}>
          <Button
            size="sm"
            variant="quiet"
            disabled={!session.pinned}
            onClick={() => change((current) => ({ ...current, pinned: undefined }))}
          >
            比較を終える
          </Button>
        </span>
      </div>
      <p className={cn(contentText.supporting, "min-h-8")}>
        {pending ? "成績を残す前に、入力を反映するか取り消してください。" : null}
      </p>
    </div>
  );
}

/** The baseline stays fixed while the page's two existing inputs remain editable. */
export function OutlookScenarioComparison({
  session,
  cumulative,
  names,
}: {
  session: OutlookSession;
  cumulative: CumulativePair;
  names: readonly [string, string];
}) {
  const baseline = session.pinned;
  if (!baseline) return null;
  const beforePair = [baseline[0].distribution, baseline[1].distribution] as const;
  const afterPair = [session.entries[0].distribution, session.entries[1].distribution] as const;
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
