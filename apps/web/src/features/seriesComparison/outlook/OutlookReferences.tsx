import { useId, useMemo } from "react";

import {
  areDistributionsCompatible,
  compareRationals,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  requiredMean,
} from "@/features/seriesComparison/model/outlook";
import type {
  CumulativePair,
  RankDistribution,
  Rational,
  RequiredMean,
} from "@/features/seriesComparison/model/outlook";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  applyOutlookDistribution,
  finishOutlookGesture,
  otherRole,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";
import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type {
  SeriesAnalysisOutlookExamples,
  SeriesAnalysisOutlookSummary,
} from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

type ExampleCondition =
  | {
      kind: "goal";
      cumulative: CumulativePair;
      required: RequiredMean;
      onUsePerformance?: (() => void) | undefined;
      pendingDescriptionId?: string | undefined;
    }
  | { kind: "mean"; role: OutlookRole };
type HistoricalExample = SeriesAnalysisOutlookExamples["examples"]["types"][number];

function meetsCondition(
  distribution: RankDistribution,
  threshold: Rational,
  kind: ExampleCondition["kind"],
  role: OutlookRole,
) {
  const comparison = compareRationals(distributionMean(distribution), threshold);
  if (kind === "goal") return comparison < 0;
  return role === 0 ? comparison <= 0 : comparison >= 0;
}

export function OutlookPastExamples({
  response,
  memberId,
  memberName,
  condition,
  session,
  change,
}: {
  response: SeriesAnalysisOutlookSummary;
  memberId: string;
  memberName: string;
  condition: ExampleCondition;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const role = condition.kind === "goal" ? 0 : condition.role;
  const peerRole = otherRole(role);
  const openKey = role === 0 ? "examplesOpen" : "rivalExamplesOpen";
  const open = session[openKey] ?? false;
  const pendingId = useId();
  const { examples: query } = useOutlookResource(response, memberId, undefined, open);
  const target = session.entries[role].distribution;
  const peer = session.entries[peerRole].distribution;
  const targetMean = useMemo(() => distributionMean(target), [target]);
  const threshold = condition.kind === "goal" ? condition.required.threshold : targetMean;
  const hasPendingInput = (current: OutlookSession) =>
    Boolean(current.gesture) ||
    current.entries[peerRole].meanDraft !== undefined ||
    current.entries[peerRole].error !== undefined ||
    (condition.kind === "mean" &&
      (current.entries[role].meanDraft !== undefined || current.entries[role].error !== undefined));
  const pending = hasPendingInput(session);
  const pendingDescriptionId =
    condition.kind === "goal" ? condition.pendingDescriptionId : pendingId;
  const invalidGoal =
    condition.kind === "goal" &&
    parseOutlookHorizon(session.goalHorizonText) !== session.goalHorizon;
  const { examples, hasQualifying } = useMemo(() => {
    const selected: SeriesAnalysisOutlookExamples["examples"]["types"] = [];
    let hasMatchingMean = false;
    if (open && query.data) {
      for (const example of query.data.examples.types) {
        const distribution = distributionFromCounts(example.rankCounts);
        if (!meetsCondition(distribution, threshold, condition.kind, role)) continue;
        hasMatchingMean = true;
        if (areDistributionsCompatible(distribution, peer)) selected.push(example);
        if (selected.length === 3) break;
      }
    }
    return { examples: selected, hasQualifying: hasMatchingMean };
  }, [query.data, open, threshold, condition.kind, peer, role]);
  const applyExample = (example: HistoricalExample) => {
    let accepted = false;
    change((current) => {
      if (
        current.artifactId !== response.artifact.artifactId ||
        current.key !== session.key ||
        hasPendingInput(current) ||
        (condition.kind === "goal" &&
          parseOutlookHorizon(current.goalHorizonText) !== current.goalHorizon)
      )
        return current;
      if (
        !distributionsEqual(current.entries[peerRole].distribution, peer) ||
        (condition.kind === "goal"
          ? current.goalHorizon !== session.goalHorizon
          : !distributionsEqual(current.entries[role].distribution, target))
      )
        return {
          ...current,
          notice: "条件が変わりました。成績例を確認して、もう一度試してください。",
        };
      const distribution = distributionFromCounts(example.rankCounts);
      const latestThreshold =
        condition.kind === "goal"
          ? requiredMean(condition.cumulative, current.entries[1].distribution, current.goalHorizon)
              .threshold
          : distributionMean(current.entries[role].distribution);
      if (
        !meetsCondition(distribution, latestThreshold, condition.kind, role) ||
        !areDistributionsCompatible(distribution, current.entries[peerRole].distribution)
      )
        return {
          ...current,
          notice: "条件が変わったため、この実績例を適用できません。",
        };
      accepted = true;
      return applyOutlookDistribution(finishOutlookGesture(current), role, distribution, {
        kind: "example",
        artifactId: current.artifactId,
        matchCount: 20,
        period: example.window.period,
      });
    });
    if (accepted && condition.kind === "goal") condition.onUsePerformance?.();
  };
  return (
    <div className={cn("min-w-0", readableTextWidthClass)}>
      <Disclosure
        ariaLabel={`${memberName}の過去の成績例`}
        summary={`${memberName}の過去の成績例`}
        open={open}
        onOpenChange={(nextOpen) => change((current) => ({ ...current, [openKey]: nextOpen }))}
        panelPadding="sm"
      >
        <div className="grid min-w-0 gap-4">
          {condition.kind === "mean" ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>
              過去の連続20戦から、平均{outlookAverage(targetMean)}位{role === 0 ? "以下" : "以上"}
              の例を選んでいます。
              {session.entries[role].meanDraft !== undefined ||
              session.entries[role].error !== undefined
                ? "入力途中の値は使わず、反映済みの平均で確認しています。"
                : null}
            </p>
          ) : null}
          {condition.kind === "mean" && pending ? (
            <p id={pendingId} className={contentText.supporting}>
              {session.gesture
                ? "平均順位の操作を終えてから、成績例を試してください。"
                : session.task === "goal" &&
                    (session.entries[0].meanDraft !== undefined ||
                      session.entries[0].error !== undefined)
                  ? "「成績から試す」で、2人の入力を反映するか、取り消してください。"
                  : "成績例を試す前に、2人の入力を反映するか、取り消してください。"}
            </p>
          ) : null}
          {query.data === undefined ? (
            query.isError ? null : (
              <p role="status" className={contentText.supporting}>
                成績例を読み込み中
              </p>
            )
          ) : query.data.examples.status === "insufficient" ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>
              作品の実績が20戦未満のため、連続20戦の例はありません。
            </p>
          ) : examples.length === 0 ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>
              {hasQualifying
                ? `${condition.kind === "goal" ? "必要な平均" : "指定した平均"}を満たす実績はありますが、${role === 0 ? "相手の指定" : "注目する人の成績"}と両立する例がありません。`
                : condition.kind === "goal"
                  ? "必要な平均を満たす20戦の実績例がありません。"
                  : "指定した平均を満たす20戦の実績例がありません。"}
            </p>
          ) : (
            <div className="grid gap-4">
              {condition.kind === "goal" ? (
                <p className={cn(contentText.body, readableTextWidthClass)}>
                  過去の連続20戦の成績から、{session.goalHorizon}
                  戦続けると上回れる例を選んでいます。
                </p>
              ) : null}
              <ul className="grid gap-4">
                {examples.map((example) => (
                  <li key={example.rankCounts.join(":")}>
                    <ContentWithActions
                      actions={
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending || invalidGoal}
                          aria-describedby={pending ? pendingDescriptionId : undefined}
                          onClick={() => applyExample(example)}
                        >
                          この成績を試す
                        </Button>
                      }
                    >
                      <div className="grid gap-1">
                        <p className={contentText.compactPrimary}>
                          {example.window.averageRank.toFixed(2)}位
                        </p>
                        <p className={contentText.body}>
                          {example.rankCounts
                            .map((count, index) => `${index + 1}位 ${count}回`)
                            .join(" / ")}
                        </p>
                        <p className={contentText.supporting}>
                          {formatDateOnly(example.window.period.startedAt)}〜
                          {formatDateOnly(example.window.period.endedAt)}
                        </p>
                      </div>
                    </ContentWithActions>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {query.isError ? (
            <Notice
              presentation="bare"
              tone={query.data ? "warning" : "danger"}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  pending={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  成績例を再読み込み
                </Button>
              }
            >
              {query.data
                ? "過去の成績例を再取得できません。取得済みの結果を表示しています。"
                : "過去の成績例を取得できません。試算は続けられます。"}
            </Notice>
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}
