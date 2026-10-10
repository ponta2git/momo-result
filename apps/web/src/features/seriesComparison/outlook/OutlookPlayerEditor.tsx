import { useState } from "react";

import {
  areDistributionsCompatible,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  rational,
  subtractRationals,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import { OutlookEditor } from "@/features/seriesComparison/outlook/OutlookEditor";
import { outlookOutcome } from "@/features/seriesComparison/outlook/outlookOutcome";
import {
  outlookAverage,
  outlookSourceLabel,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  applyOutlookDistribution,
  draftOutlook,
  finishOutlookGesture,
  otherRole,
  outlookPlayer,
  undoOutlook,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { contentText } from "@/shared/ui/typography";

type Props = {
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  session: OutlookSession;
  role: OutlookRole;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  showComparison?: boolean;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
};

/** A named player's condition stays next to both ways of changing it. */
export function OutlookPlayerEditor(props: Props) {
  const { response, session, role, names, memberIds, change, showComparison = false } = props;
  const entry = session.entries[role];
  const baseline = showComparison ? session.pinned?.[role].distribution : undefined;
  const recent = distributionFromCounts(
    outlookPlayer(response.recent.players, memberIds[role]).rankCounts,
  );
  const unchanged =
    distributionsEqual(entry.distribution, recent) &&
    entry.meanDraft === undefined &&
    entry.source.kind === "recent" &&
    entry.source.artifactId === session.artifactId;
  const difference = subtractRationals(
    distributionMean(recent),
    distributionMean(entry.distribution),
  );
  const differenceLabel =
    difference.numerator === 0n
      ? "直近と同じ平均"
      : `直近より${outlookAverage(rational(difference.numerator < 0n ? -difference.numerator : difference.numerator, difference.denominator))}位${difference.numerator > 0n ? "上" : "下"}`;
  const outdated =
    entry.source.artifactId !== undefined && entry.source.artifactId !== session.artifactId;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2" aria-label={`${names[role]}の成績を試す`}>
      <h3 className={cn(contentText.heading, "flex items-center")}>
        <MemberSequenceLabel memberId={memberIds[role]}>{names[role]}</MemberSequenceLabel>
      </h3>
      <p
        className={contentText.supporting}
        aria-label={`${names[role]}の${baseline ? "比較基準" : "直近の平均"}`}
      >
        {baseline ? "残した平均" : "直近の平均"}{" "}
        {outlookAverage(distributionMean(baseline ?? recent))}位
      </p>
      <OutlookEditor
        session={session}
        role={role}
        method="mean"
        name={names[role]}
        label="これからの平均順位"
        change={change}
      />
      <div className="grid gap-1">
        <p className={contentText.supporting} aria-label={`${names[role]}の直近からの差`}>
          {outdated ? "更新前の成績 · " : ""}
          {differenceLabel}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="quiet"
            disabled={unchanged}
            aria-label={`${names[role]}を直近の成績に戻す`}
            onClick={() =>
              change((current) =>
                applyOutlookDistribution(finishOutlookGesture(current), role, recent, {
                  kind: "recent",
                  artifactId: response.artifact.artifactId,
                  matchCount: response.recent.matchCount,
                  ...(response.recent.period ? { period: response.recent.period } : {}),
                }),
              )
            }
          >
            直近に戻す
          </Button>
          <OutlookCountDialog {...props} />
        </div>
      </div>
    </section>
  );
}

type CountStart = Pick<Props, "session" | "cumulative" | "names" | "role">;

function OutlookCountDialog(props: Props) {
  const { session, cumulative, role, names } = props;
  const [opened, setOpened] = useState<CountStart>();
  return (
    <Dialog
      open={opened !== undefined}
      onOpenChange={(open) =>
        setOpened(open ? { session: draftOutlook(session), cumulative, names, role } : undefined)
      }
      title={`${opened ? opened.names[opened.role] : names[role]}の順位の回数を変える`}
      trigger={
        <Button variant="quiet" size="sm" aria-label={`${names[role]}を順位の回数で設定`}>
          回数で設定
        </Button>
      }
    >
      {opened ? (
        <CountProposal {...props} initial={opened} close={() => setOpened(undefined)} />
      ) : null}
    </Dialog>
  );
}

function CountProposal({
  initial,
  close,
  ...props
}: Props & {
  initial: CountStart;
  close: () => void;
}) {
  const { session, change } = props;
  const { role, names } = initial;
  const [draft, setDraft] = useState(initial.session);
  const [editorVersion, setEditorVersion] = useState(0);
  const entry = draft.entries[role];
  const stale =
    session.key !== initial.session.key || session.artifactId !== initial.session.artifactId;
  const outcome = outlookOutcome(
    initial.cumulative,
    [draft.entries[0].distribution, draft.entries[1].distribution],
    names,
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <p className={contentText.supporting}>
        {outlookSourceLabel(entry.source, session.artifactId)}
      </p>
      <OutlookEditor
        key={editorVersion}
        session={draft}
        role={role}
        method="counts"
        name={names[role]}
        change={setDraft}
      />
      <div
        className="grid gap-2 border-t border-[var(--color-border)] pt-4"
        aria-label="この回数を続けた結果"
      >
        <p className={contentText.heading}>
          {names[role]}の平均：{outlookAverage(distributionMean(entry.distribution))}位
        </p>
        <p className={contentText.body}>{outcome.headline}</p>
        {outcome.detail ? <p className={contentText.supporting}>{outcome.detail}</p> : null}
        <Button
          size="sm"
          variant="quiet"
          disabled={draft.history.length === 0 && !draft.gesture}
          onClick={() => {
            setDraft((current) => undoOutlook(finishOutlookGesture(current)));
            setEditorVersion((version) => version + 1);
          }}
        >
          回数の変更を戻す
        </Button>
      </div>
      {stale ? (
        <p className={contentText.body} role="status">
          実績または比較する人が変わりました。閉じて、現在の条件から設定し直してください。
        </p>
      ) : null}
      <DialogFooter data-outlook-preserve-draft>
        <Button variant="quiet" onClick={close}>
          キャンセル
        </Button>
        <Button
          variant="primary"
          aria-disabled={stale || entry.error !== undefined || undefined}
          onClick={() => {
            if (stale || entry.error !== undefined) return;
            let accepted = false;
            change((current) => {
              if (
                current.key !== initial.session.key ||
                current.artifactId !== initial.session.artifactId ||
                !areDistributionsCompatible(
                  entry.distribution,
                  current.entries[otherRole(role)].distribution,
                )
              )
                return current;
              accepted = true;
              return applyOutlookDistribution(
                finishOutlookGesture(current),
                role,
                entry.distribution,
                entry.source,
              );
            });
            if (accepted) close();
          }}
        >
          この回数を使う
        </Button>
      </DialogFooter>
    </div>
  );
}
