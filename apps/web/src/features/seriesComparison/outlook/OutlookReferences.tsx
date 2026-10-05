import {
  areDistributionsCompatible,
  compareRationals,
  distributionFromCounts,
  distributionMean,
  formatRational,
  rational,
  requiredMean,
  subtractRationals,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import {
  applyOutlookDistribution,
  outlookPlayer,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
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
  cumulative,
  session,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusId: string;
  cumulative: CumulativePair;
  session: OutlookSession;
}) {
  const { window } = useOutlookResource(response, focusId, session.horizon, false);
  const rows = [...new Set([session.horizon, 50, 100])].map((h) => {
    const required = requiredMean(cumulative, session.entries[1].distribution, h);
    const recent = outlookPlayer(response.recent.players, focusId);
    const improvement =
      required.maximumHundredths === null
        ? null
        : subtractRationals(
            distributionMean(distributionFromCounts(recent.rankCounts)),
            rational(BigInt(required.maximumHundredths), 100n),
          );
    const best = response.bestWindows.find(
      (item) => item.memberId === focusId && item.windowSize === h,
    );
    const historical = h === 50 || h === 100 ? best : window.data;
    const recentCompatible = areDistributionsCompatible(
      distributionFromCounts(recent.rankCounts),
      session.entries[1].distribution,
    );
    return { h, required, improvement, historical, recentCompatible };
  });
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="outlook-requirements-heading">
      <h2 id="outlook-requirements-heading" className={contentText.heading}>
        上回るための成績
      </h2>
      <DataTable
        caption={{ content: "必要な成績と同期間の過去実績", visibility: "screen-reader" }}
        rows={rows}
        getRowKey={(row) => String(row.h)}
        density="compact"
        columns={[
          {
            key: "games",
            header: "この先",
            rowHeader: true,
            renderCell: (row) => `${row.h}戦後`,
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
                <span>
                  {row.historical.window.averageRank.toFixed(2)}位
                  <small className="block">
                    {row.historical.window.period.startedAt.slice(0, 10)}〜
                    {row.historical.window.period.endedAt.slice(0, 10)}
                  </small>
                </span>
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
  session,
  change,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusId: string;
  focusName: string;
  cumulative: CumulativePair;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const { examples: query } = useOutlookResource(
    response,
    focusId,
    undefined,
    session.examplesOpen,
  );
  const required = requiredMean(cumulative, session.entries[1].distribution, session.horizon);
  const qualifying =
    query.data?.examples.types.filter(
      (example) =>
        compareRationals(
          distributionMean(distributionFromCounts(example.rankCounts)),
          required.threshold,
        ) < 0,
    ) ?? [];
  const examples = qualifying
    .filter((example) =>
      areDistributionsCompatible(
        distributionFromCounts(example.rankCounts),
        session.entries[1].distribution,
      ),
    )
    .slice(0, 3);
  return (
    <Disclosure
      ariaLabel={`${focusName}の過去の成績例`}
      summary={`${focusName}の過去の成績例`}
      open={session.examplesOpen}
      onOpenChange={(open) => change((current) => ({ ...current, examplesOpen: open }))}
      panelPadding="sm"
    >
      <div className="grid gap-3">
        {query.isError ? (
          <div>
            <p className={contentText.body}>過去の成績例を取得できません。試算は続けられます。</p>
            <Button
              size="sm"
              variant="secondary"
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              成績例を再読み込み
            </Button>
          </div>
        ) : !query.data ? (
          <p role="status" className={contentText.supporting}>
            成績例を読み込み中
          </p>
        ) : query.data.examples.status === "insufficient" ? (
          <p className={contentText.body}>作品の実績が20戦未満のため、連続20戦の例はありません。</p>
        ) : !examples.length ? (
          <p className={contentText.body}>
            {qualifying.length
              ? "必要な平均を満たす実績はありますが、相手の指定と両立する例がありません。"
              : "必要な平均を満たす20戦の実績例がありません。"}{" "}
          </p>
        ) : (
          <div className="grid gap-3">
            <p className={contentText.body}>
              過去の連続20戦の成績から、{session.horizon}戦続けると上回れる例を選んでいます。
            </p>
            <ul className="grid gap-4">
              {examples.map((example) => (
                <li
                  key={example.rankCounts.join(":")}
                  className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <p className={contentText.body}>
                      {example.window.averageRank.toFixed(2)}位 ·{" "}
                      {example.rankCounts
                        .map((count, index) => `${index + 1}位 ${count}回`)
                        .join(" / ")}
                    </p>
                    <p className={contentText.supporting}>
                      {example.window.period.startedAt.slice(0, 10)}〜
                      {example.window.period.endedAt.slice(0, 10)}
                    </p>
                  </div>
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
                        if (compareRationals(distributionMean(distribution), latest.threshold) >= 0)
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
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
