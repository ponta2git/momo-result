import { useState } from "react";

import { distributionMean } from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import { OutlookEditor } from "@/features/seriesComparison/outlook/OutlookEditor";
import {
  compareOutlookOutcomes,
  outlookOutcome,
} from "@/features/seriesComparison/outlook/outlookOutcome";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  applyOutlookPair,
  canPinOutlook,
  draftOutlook,
  finishOutlookGesture,
  pinOutlook,
  undoOutlook,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { contentText } from "@/shared/ui/typography";

type Props = {
  session: OutlookSession;
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  change: (update: (current: OutlookSession) => OutlookSession) => void;
};
type ComparisonStart = Omit<Props, "change">;

export function OutlookScenarioComparison({
  session,
  cumulative,
  names,
  memberIds,
  change,
}: Props) {
  const [opened, setOpened] = useState<ComparisonStart>();
  return (
    <div className="grid min-w-0 gap-1" data-outlook-preserve-draft>
      <Dialog
        title="2つの成績を比べる"
        popupClassName="max-w-[64rem]"
        open={opened !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpened(undefined);
          else setOpened({ session: draftOutlook(session), cumulative, names, memberIds });
        }}
        trigger={
          <Button size="sm" variant="secondary">
            {session.pinned ? "残した成績と比べる" : "別の成績と比べる"}
          </Button>
        }
      >
        {opened ? (
          <ComparisonProposal
            initial={opened}
            current={session}
            change={change}
            close={() => setOpened(undefined)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function ComparisonProposal({
  initial,
  current,
  change,
  close,
}: {
  initial: ComparisonStart;
  current: OutlookSession;
  change: Props["change"];
  close: () => void;
}) {
  const { cumulative, names, memberIds } = initial;
  const [draft, setDraft] = useState(() =>
    initial.session.pinned ? initial.session : pinOutlook(initial.session),
  );
  const baseline = draft.pinned;
  const stale =
    current.key !== initial.session.key || current.artifactId !== initial.session.artifactId;
  const pending =
    Boolean(draft.gesture) ||
    draft.entries.some((entry) => entry.meanDraft !== undefined || entry.error !== undefined);
  if (!baseline) return null;
  const beforePair = [baseline[0].distribution, baseline[1].distribution] as const;
  const afterPair = [draft.entries[0].distribution, draft.entries[1].distribution] as const;
  const before = outlookOutcome(cumulative, beforePair, names);
  const after = outlookOutcome(cumulative, afterPair, names);
  const sameOutcome = before.headline === after.headline && before.detail === after.detail;
  const roles = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
        {roles.map(({ memberId, role }) => (
          <section
            key={memberId}
            className="grid min-w-0 content-start gap-2"
            aria-label={`${names[role]}の成績を比べる`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>
              <p className={contentText.supporting} aria-label={`${names[role]}の比較基準`}>
                基準の平均 {outlookAverage(distributionMean(baseline[role].distribution))}位
              </p>
            </div>
            <OutlookEditor
              session={draft}
              role={role}
              method="mean"
              name={names[role]}
              label="試す平均順位"
              change={setDraft}
            />
          </section>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" data-outlook-preserve-draft>
        <Button
          size="sm"
          variant="quiet"
          disabled={draft.history.length === 0 && !draft.gesture}
          onClick={() => setDraft((value) => undoOutlook(finishOutlookGesture(value)))}
        >
          成績を1つ戻す
        </Button>
        <Button
          size="sm"
          variant="quiet"
          disabled={!canPinOutlook(draft)}
          onClick={() => setDraft(pinOutlook)}
        >
          2人の成績を基準にする
        </Button>
      </div>
      <div className="grid gap-4 border-t border-[var(--color-border)] pt-4">
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
              { label: "基準", outcome: before },
              { label: "試す成績", outcome: after },
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
      {pending ? (
        <p className={contentText.supporting}>入力を反映するか、取り消してください。</p>
      ) : null}
      {stale ? (
        <p className={contentText.body} role="status">
          実績または比較する人が変わりました。閉じて、現在の条件から比べ直してください。
        </p>
      ) : null}
      <DialogFooter data-outlook-preserve-draft>
        <Button variant="quiet" onClick={close}>
          キャンセル
        </Button>
        <Button
          variant="primary"
          disabled={pending || stale}
          onClick={() => {
            let accepted = false;
            change((value) => {
              if (
                value.key !== initial.session.key ||
                value.artifactId !== initial.session.artifactId
              )
                return value;
              accepted = true;
              return {
                ...applyOutlookPair(value, [draft.entries[0], draft.entries[1]]),
                pinned: baseline,
              };
            });
            if (accepted) close();
          }}
        >
          2人に反映
        </Button>
      </DialogFooter>
    </div>
  );
}
