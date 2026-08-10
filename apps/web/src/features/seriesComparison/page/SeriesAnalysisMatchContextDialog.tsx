import type { ReactNode } from "react";

import {
  directionLabel,
  formatDateTime,
  formatDecimal,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { useSeriesAnalysisMatchContext } from "@/features/seriesComparison/page/useSeriesAnalysisMatchContext";
import type { SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function SeriesAnalysisMatchContextDialog({
  baseQuery,
  matchId,
  onArtifactExpired,
  onClose,
}: {
  baseQuery: SeriesAnalysisQuery;
  matchId: string | undefined;
  onArtifactExpired: () => void;
  onClose: () => void;
}) {
  const query = useSeriesAnalysisMatchContext({ baseQuery, matchId, onArtifactExpired });

  const response = query.data;
  return (
    <Dialog
      className="overflow-y-auto"
      description={
        response?.match
          ? formatDateTime(response.match.playedAt)
          : "保存済み成果物との対応を確認します。"
      }
      open={Boolean(matchId)}
      popupClassName="max-w-[64rem]"
      title={response?.match ? `第${response.match.matchIndex}戦の分析` : "試合の分析"}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {query.isPending ? (
        <div aria-label="試合分析を読み込み中" className="grid gap-3">
          <Skeleton className="min-h-12" />
          <Skeleton className="min-h-40" />
        </div>
      ) : query.isError ? (
        <Notice tone="danger" title="試合の分析を読み込めません">
          <p>一次データには影響しません。保存済み分析だけを取得できませんでした。</p>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              再読み込み
            </Button>
          </div>
        </Notice>
      ) : response?.inclusion.status === "included" && response.match ? (
        <div className="grid gap-4">
          {response.match.features.length > 0 ? (
            <section>
              <h3 className="text-sm font-semibold">この試合の注目点</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {response.match.features.map((feature) => (
                  <li
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm"
                    key={`${feature.priority}:${feature.featureCode}`}
                  >
                    {featureLabel(feature.featureCode)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead>
                <tr>
                  <TableHead>プレーヤー</TableHead>
                  <TableHead>順位</TableHead>
                  <TableHead>総資産</TableHead>
                  <TableHead>物件収益</TableHead>
                  <TableHead>収益順位</TableHead>
                  <TableHead>収益/資産</TableHead>
                  <TableHead>通算平均</TableHead>
                  <TableHead>変化</TableHead>
                </tr>
              </thead>
              <tbody>
                {response.match.players.map((player) => (
                  <tr className="border-t border-[var(--color-border)]" key={player.memberId}>
                    <TableCell>
                      <span className="font-semibold">{player.displayName}</span>
                    </TableCell>
                    <TableCell>{player.rank}位</TableCell>
                    <TableCell>{formatManYen(player.totalAssetsManYen)}</TableCell>
                    <TableCell>{formatManYen(player.revenueManYen)}</TableCell>
                    <TableCell>{formatDecimal(player.revenueRank)}位</TableCell>
                    <TableCell>{formatPercent(player.revenueAssetRate)}</TableCell>
                    <TableCell>{formatDecimal(player.cumulativeAverageAfter)}位</TableCell>
                    <TableCell>{directionLabel(player.cumulativeAverageDirection)}</TableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Notice tone="warning" title={inclusionTitle(response?.inclusion.status)}>
          <p>古い分析値を表示せず、最新の計算完了を待ちます。</p>
        </Notice>
      )}
    </Dialog>
  );
}

function inclusionTitle(status: string | undefined): string {
  switch (status) {
    case "match_changed_since_artifact":
      return "この試合は分析後に更新されています";
    case "not_in_scope":
      return "現在の比較条件には含まれません";
    case "not_in_artifact":
      return "この成果物には試合分析がありません";
    default:
      return "試合分析を表示できません";
  }
}

function featureLabel(code: string): string {
  switch (code) {
    case "close_finish":
      return "上位が接戦だった試合";
    case "asset_blowout":
      return "総資産差が大きかった試合";
    case "revenue_top_no_win":
      return "物件収益首位が勝ち切れなかった試合";
    case "ginji_storm":
      return "スリの銀次が複数回発生";
    case "negative_assets":
      return "マイナス資産のプレーヤーあり";
    case "no_destination":
      return "目的地到着なしのプレーヤーあり";
    case "destination_burst":
      return "目的地到着が集中";
    case "low_revenue_win":
      return "低収益からの勝利";
    case "fourth_order_win":
      return "4番手からの勝利";
    default:
      return code;
  }
}

function TableHead({ children }: { children: ReactNode }) {
  return (
    <th className="bg-[var(--color-surface-subtle)] px-3 py-2 font-semibold text-[var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function TableCell({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 tabular-nums">{children}</td>;
}
