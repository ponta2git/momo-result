import { useId, useState } from "react";

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
import { FactList } from "@/shared/ui/data/FactList";
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
  const descriptionId = useId();
  const pending =
    Boolean(session.gesture) ||
    session.entries.some((entry) => entry.meanDraft !== undefined || entry.error !== undefined);
  return (
    <div className="grid min-w-0 gap-1" data-outlook-preserve-draft>
      <Dialog
        title="2つの成績を比べる"
        popupClassName="max-w-[64rem]"
        open={opened !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpened(undefined);
          else if (!pending)
            setOpened({ session: draftOutlook(session), cumulative, names, memberIds });
        }}
        trigger={
          <Button
            size="sm"
            variant="secondary"
            aria-disabled={pending || undefined}
            aria-describedby={pending ? descriptionId : undefined}
          >
            {session.pinned ? "残した条件と比べる" : "別の成績と比べる"}
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
      {pending ? (
        <p id={descriptionId} className="sr-only">
          入力を反映すると比べられます。
        </p>
      ) : null}
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
  const roles = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
        <section className="grid min-w-0 content-start gap-4" aria-label="比較の基準">
          <div className="grid gap-2">
            <h3 className={contentText.heading}>比較の基準</h3>
            <p className={contentText.primary}>{before.headline}</p>
            {before.detail ? <p className={contentText.body}>{before.detail}</p> : null}
          </div>
          <FactList
            ariaLabel="残した成績"
            items={roles.map(({ memberId, role }) => ({
              id: memberId,
              label: <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>,
              value: `これからの平均 ${outlookAverage(distributionMean(baseline[role].distribution))}位`,
            }))}
          />
        </section>
        <section className="grid min-w-0 content-start gap-4" aria-label="比較する成績の編集">
          <div className="grid gap-2">
            <h3 className={contentText.heading}>試す条件</h3>
          </div>
          {roles.map(({ memberId, role }) => (
            <OutlookEditor
              key={memberId}
              session={draft}
              role={role}
              method="mean"
              name={names[role]}
              change={setDraft}
            />
          ))}
          <div className="flex flex-wrap gap-2" data-outlook-preserve-draft>
            <Button
              size="sm"
              variant="quiet"
              disabled={draft.history.length === 0 && !draft.gesture}
              onClick={() => setDraft((value) => undoOutlook(finishOutlookGesture(value)))}
            >
              変更を戻す
            </Button>
            <Button
              size="sm"
              variant="quiet"
              aria-disabled={!canPinOutlook(draft) || undefined}
              onClick={() => setDraft(pinOutlook)}
            >
              試した条件を基準にする
            </Button>
          </div>
          <div className="grid gap-2">
            <p className={contentText.primary}>{after.headline}</p>
            {after.detail ? <p className={contentText.body}>{after.detail}</p> : null}
          </div>
          {pending ? (
            <p className={contentText.supporting}>入力を反映してから、この条件を使えます。</p>
          ) : null}
        </section>
      </div>
      <p className={contentText.primary} role="status">
        {compareOutlookOutcomes(cumulative, beforePair, afterPair, names)}
      </p>
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
          この条件を使う
        </Button>
      </DialogFooter>
    </div>
  );
}
