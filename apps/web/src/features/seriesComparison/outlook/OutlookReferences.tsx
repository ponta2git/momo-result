import { useId, useMemo } from "react";

import {
  areDistributionsCompatible,
  compareRationals,
  countsFromMean,
  distributionFromCounts,
  distributionMean,
  formatRational,
  rational,
  requiredMean,
  subtractRationals,
} from "@/features/seriesComparison/model/outlook";
import type {
  CumulativePair,
  RankDistribution,
  RequiredMean,
} from "@/features/seriesComparison/model/outlook";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  applyOutlookDistribution,
  finishOutlookGesture,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type {
  SeriesAnalysisOutlookExamples,
  SeriesAnalysisOutlookSummary,
} from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function requiredMeanText(required: ReturnType<typeof requiredMean>) {
  if (required.kind === "mean" && required.maximumHundredths !== null)
    return `${(required.maximumHundredths / 100).toFixed(2)}位以下`;
  if (required.kind === "precision-impossible") return "0.01刻みでは指定できません";
  return "相手がこの成績なら届きません";
}

export function OutlookRequirements({
  response,
  focusId,
  names,
  cumulative,
  session,
  change,
  recent,
  requirements,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusId: string;
  names: readonly [string, string];
  cumulative: CumulativePair;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
  recent: RankDistribution;
  requirements: ReadonlyArray<{
    key: "custom" | "fifty" | "hundred";
    h: number;
    required: RequiredMean;
  }>;
}) {
  const conditionId = useId();
  const { horizon } = session;
  const valid = parseOutlookHorizon(session.horizonText) !== undefined;
  const focus = session.entries[0].distribution;
  const rival = session.entries[1].distribution;
  const selected = requirements.find((row) => row.key === "custom")?.required;
  const maximum = selected?.maximumHundredths ?? null;
  const focusMean = distributionMean(focus);
  const reaches =
    selected !== undefined &&
    compareRationals(focusMean, selected.threshold) < 0 &&
    areDistributionsCompatible(focus, rival);
  const applied =
    maximum !== null &&
    session.entries[0].source.kind === "average" &&
    compareRationals(focusMean, rational(BigInt(maximum), 100n)) === 0;
  const { window } = useOutlookResource(response, focusId, horizon, false);
  const recentMean = distributionMean(recent);
  const recentCompatible = areDistributionsCompatible(recent, rival);
  const rows = requirements.map(({ key, h, required }) => {
    const improvement =
      required.maximumHundredths === null
        ? null
        : subtractRationals(recentMean, rational(BigInt(required.maximumHundredths), 100n));
    const best = response.bestWindows.find(
      (item) => item.memberId === focusId && item.windowSize === h,
    );
    const historical = h === 50 || h === 100 ? best : window.data;
    return { key, h, required, improvement, historical, recentCompatible };
  });
  return (
    <section
      className="grid min-w-0 gap-4"
      aria-labelledby="outlook-requirements-heading"
      data-outlook-preserve-draft
    >
      <h2 id="outlook-requirements-heading" className={contentText.heading}>
        {horizon}戦後に{names[0]}が上回るための成績
      </h2>
      {reaches || maximum !== null ? (
        <div className="grid min-w-0 justify-items-start">
          {reaches && !applied ? (
            <p className={contentText.body}>今の成績で条件を満たしています。</p>
          ) : maximum !== null ? (
            <Button
              size="sm"
              variant={applied ? "quiet" : "secondary"}
              disabled={!valid}
              aria-disabled={applied || undefined}
              aria-describedby={conditionId}
              onClick={() => {
                if (!valid || applied) return;
                change((current) => {
                  if (
                    current.artifactId !== response.artifact.artifactId ||
                    current.key !== session.key ||
                    parseOutlookHorizon(current.horizonText) === undefined
                  )
                    return current;
                  const latest = requiredMean(
                    cumulative,
                    current.entries[1].distribution,
                    current.horizon,
                  );
                  if (current.horizon !== horizon || latest.maximumHundredths !== maximum)
                    return {
                      ...current,
                      notice: "条件が変わりました。必要な平均を確認して、もう一度試してください。",
                    };
                  const currentMean = distributionMean(current.entries[0].distribution);
                  if (compareRationals(currentMean, latest.threshold) < 0) return current;
                  const distribution = countsFromMean(
                    maximum,
                    current.entries[1].distribution,
                    current.entries[0].distribution,
                  );
                  if (!distribution) return current;
                  return {
                    ...applyOutlookDistribution(finishOutlookGesture(current), 0, distribution, {
                      kind: "average",
                    }),
                    editor: 0,
                    method: "mean",
                  };
                });
              }}
            >
              {applied
                ? `${names[0]}に平均${(maximum / 100).toFixed(2)}位を適用中`
                : `${names[0]}を平均${(maximum / 100).toFixed(2)}位で試す`}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p id={conditionId} className={contentText.body}>
        {names[1]}は平均{outlookAverage(distributionMean(rival))}位を続ける条件です。
      </p>
      <DataTable
        caption={{ content: "必要な成績と同期間の過去実績", visibility: "screen-reader" }}
        rows={rows}
        getRowKey={(row) => row.key}
        density="compact"
        layout="fixed"
        minWidth="40rem"
        stickyRowHeader
        columns={[
          {
            key: "games",
            header: "この先",
            rowHeader: true,
            width: "7rem",
            renderCell: (row) =>
              row.key === "custom" ? (
                <div className="grid gap-1">
                  <span className={contentText.supporting}>指定した戦数</span>
                  <span>{row.h}戦後</span>
                </div>
              ) : (
                `${row.h}戦後`
              ),
          },
          {
            key: "required",
            header: "必要な平均順位",
            renderCell: (row) => requiredMeanText(row.required),
          },
          {
            key: "improvement",
            header: "直近から",
            renderCell: (row) =>
              row.improvement === null
                ? "—"
                : row.improvement.numerator > 0n
                  ? `${formatRational(row.improvement, 2)}位の改善`
                  : row.recentCompatible
                    ? "直近の成績で届く"
                    : "平均は条件内・内訳の変更が必要",
          },
          {
            key: "best",
            header: "同期間の自己ベスト",
            renderCell: (row) =>
              row.historical?.window ? (
                <div className="grid gap-1">
                  <span>{row.historical.window.averageRank.toFixed(2)}位</span>
                  <span className={cn(contentText.supporting, "whitespace-nowrap")}>
                    {formatDateOnly(row.historical.window.period.startedAt)}〜
                    {formatDateOnly(row.historical.window.period.endedAt)}
                  </span>
                </div>
              ) : row.historical?.status === "insufficient" ? (
                `作品の実績${response.source.titleMatchCount}戦では不足`
              ) : window.isError ? (
                <Button
                  size="sm"
                  variant="quiet"
                  pending={window.isFetching}
                  onClick={() => void window.refetch()}
                >
                  過去実績を再読み込み
                </Button>
              ) : (
                "過去実績を読み込み中"
              ),
          },
        ]}
      />
    </section>
  );
}

export function OutlookPastExamples({
  response,
  focusId,
  focusName,
  cumulative,
  required,
  session,
  change,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusId: string;
  focusName: string;
  cumulative: CumulativePair;
  required: RequiredMean;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const { examples: query } = useOutlookResource(
    response,
    focusId,
    undefined,
    session.examplesOpen,
  );
  const rival = session.entries[1].distribution;
  const { examples, hasQualifying } = useMemo(() => {
    const selected: SeriesAnalysisOutlookExamples["examples"]["types"] = [];
    let hasMatchingMean = false;
    if (session.examplesOpen && query.data) {
      for (const example of query.data.examples.types) {
        const distribution = distributionFromCounts(example.rankCounts);
        if (compareRationals(distributionMean(distribution), required.threshold) >= 0) continue;
        hasMatchingMean = true;
        if (areDistributionsCompatible(distribution, rival)) selected.push(example);
        if (selected.length === 3) break;
      }
    }
    return { examples: selected, hasQualifying: hasMatchingMean };
  }, [query.data, session.examplesOpen, required.threshold, rival]);
  return (
    <Disclosure
      ariaLabel={`${focusName}の過去の成績例`}
      summary={`${focusName}の過去の成績例`}
      open={session.examplesOpen}
      onOpenChange={(open) => change((current) => ({ ...current, examplesOpen: open }))}
      triggerLayout="flush-horizontal"
      panelSpacing="sm"
    >
      <div className="grid min-w-0 gap-4">
        {!query.data ? (
          query.isError ? null : (
            <p role="status" className={contentText.supporting}>
              成績例を読み込み中
            </p>
          )
        ) : query.data.examples.status === "insufficient" ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
            作品の実績が20戦未満のため、連続20戦の例はありません。
          </p>
        ) : !examples.length ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
            {hasQualifying
              ? "必要な平均を満たす実績はありますが、相手の指定と両立する例がありません。"
              : "必要な平均を満たす20戦の実績例がありません。"}{" "}
          </p>
        ) : (
          <div className="grid gap-4">
            <p className={cn(contentText.body, readableTextWidthClass)}>
              過去の連続20戦の成績から、{session.horizon}戦続けると上回れる例を選んでいます。
            </p>
            <ul className="grid gap-4">
              {examples.map((example) => (
                <li key={example.rankCounts.join(":")}>
                  <ContentWithActions
                    actions={
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          change((current) => {
                            if (current.artifactId !== response.artifact.artifactId) return current;
                            const distribution = distributionFromCounts(example.rankCounts);
                            const latest = requiredMean(
                              cumulative,
                              current.entries[1].distribution,
                              current.horizon,
                            );
                            if (
                              compareRationals(distributionMean(distribution), latest.threshold) >=
                              0
                            )
                              return {
                                ...current,
                                notice: "条件が変わったため、この実績例では上回れません。",
                              };
                            return applyOutlookDistribution(current, 0, distribution, {
                              kind: "example",
                              artifactId: current.artifactId,
                              matchCount: 20,
                              period: example.window.period,
                            });
                          })
                        }
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
  );
}
