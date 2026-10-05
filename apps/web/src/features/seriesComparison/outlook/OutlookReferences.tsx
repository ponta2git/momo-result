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
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText } from "@/shared/ui/typography";

export function requiredMeanText(required: ReturnType<typeof requiredMean>, h: number) {
  if (required.kind === "mean" && required.maximumHundredths !== null)
    return `${(required.maximumHundredths / 100).toFixed(2)}位以下`;
  if (required.kind === "counts") return "回数で調整すると、この条件を試せます";
  if (required.kind === "precision-impossible")
    return `入力できる細かさでは、${h}戦後に上回る成績を指定できません`;
  return `相手の成績を変えない場合、${h}戦後には上回れません`;
}

export function OutlookRequirements({
  response,
  focusId,
  cumulative,
  session,
  change,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusId: string;
  cumulative: CumulativePair;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const { window } = useOutlookResource(response, focusId, session.horizon, false);
  const rows = [...new Set([50, 100, session.horizon])].map((h) => {
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
    return { h, required, improvement, historical };
  });
  const validHorizon =
    /^\d+$/u.test(session.horizonText) &&
    Number(session.horizonText) >= 1 &&
    Number(session.horizonText) <= 1000;
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="outlook-requirements-heading">
      <h2 id="outlook-requirements-heading" className={contentText.heading}>
        この試合数で上回るには
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
            renderCell: (row) => (
              <Button
                size="sm"
                variant={row.h === session.horizon ? "secondary" : "quiet"}
                aria-pressed={row.h === session.horizon}
                onClick={() =>
                  change((current) => ({ ...current, horizon: row.h, horizonText: String(row.h) }))
                }
              >
                {row.h}戦後を確認
              </Button>
            ),
          },
          {
            key: "required",
            header: "必要な平均順位",
            renderCell: (row) => requiredMeanText(row.required, row.h),
          },
          {
            key: "improvement",
            header: "直近から",
            renderCell: (row) =>
              row.improvement === null
                ? "—"
                : row.improvement.numerator > 0n
                  ? `${formatRational(row.improvement, 2)}位の改善`
                  : "直近の成績で条件を満たす",
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
      <div className="max-w-sm">
        <TextField
          label="この先何戦で比べるか"
          description="1〜1000戦。成績の指定は変えず、確認する時点を変えます。"
          inputMode="numeric"
          value={session.horizonText}
          error={
            validHorizon
              ? undefined
              : "1〜1000の整数を入力してください。直前の有効な戦数を表示しています。"
          }
          onChange={(event) => {
            const text = event.target.value;
            change((current) => ({ ...current, horizonText: text }));
          }}
          onBlur={() => {
            if (validHorizon)
              change((current) => ({ ...current, horizon: Number(current.horizonText) }));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && validHorizon) {
              event.preventDefault();
              change((current) => ({ ...current, horizon: Number(current.horizonText) }));
            }
          }}
        />
      </div>
      <p className={contentText.supporting}>
        過去の自己ベストは当時の相手・展開を含む実績です。この成績を今後も続けられる保証ではありません。
      </p>
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
      ariaLabel="過去の成績例"
      summary="過去の成績例"
      open={session.examplesOpen}
      onOpenChange={(open) => change((current) => ({ ...current, examplesOpen: open }))}
      panelPadding="sm"
    >
      <div className="grid gap-3">
        <p className={contentText.body}>
          {focusName}
          の実際の連続20戦から、必要な平均を満たし、直近の内訳に近い例です。適用すると、この内訳を
          {session.horizon}戦続ける仮定で試します。
        </p>
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
            手入力で成立する成績を試せます。
          </p>
        ) : (
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
                  disabled={Boolean(session.entries[0].countDraft)}
                  onClick={() =>
                    change((current) => {
                      if (
                        current.artifactId !== response.artifact.artifactId ||
                        current.entries[0].countDraft
                      )
                        return current;
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
        )}
      </div>
    </Disclosure>
  );
}
