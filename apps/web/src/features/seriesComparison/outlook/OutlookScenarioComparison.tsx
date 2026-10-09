import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import {
  compareOutlookOutcomes,
  outlookOutcome,
} from "@/features/seriesComparison/outlook/outlookOutcome";
import { canPinOutlook, pinOutlook } from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { Button } from "@/shared/ui/actions/Button";
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
          onClick={() => change(pinOutlook)}
        >
          {session.pinned ? "今の成績を基準にする" : "この成績を残して比べる"}
        </Button>
        {session.pinned ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => change((current) => ({ ...current, pinned: undefined }))}
          >
            比較を終える
          </Button>
        ) : null}
      </div>
      {pending ? (
        <p className={contentText.supporting}>
          成績を残す前に、入力を反映するか取り消してください。
        </p>
      ) : null}
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
  const sameOutcome = before.headline === after.headline && before.detail === after.detail;
  return (
    <div className="grid min-w-0 gap-4">
      <p className={contentText.primary} role="status">
        {compareOutlookOutcomes(cumulative, beforePair, afterPair, names)}
      </p>
      {sameOutcome ? (
        before.eventHorizon !== null ? (
          <div className="grid gap-1">
            <p className={contentText.body}>{before.headline}</p>
            {before.detail ? <p className={contentText.supporting}>{before.detail}</p> : null}
          </div>
        ) : null
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          {[
            { label: "残した成績", outcome: before },
            { label: "今の成績", outcome: after },
          ].map(({ label, outcome }) => (
            <div key={label} className="contents">
              <dt className={contentText.supporting}>{label}</dt>
              <dd className={contentText.body}>
                {outcome.headline}
                {outcome.detail ? (
                  <span className={`${contentText.supporting} block`}>{outcome.detail}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
