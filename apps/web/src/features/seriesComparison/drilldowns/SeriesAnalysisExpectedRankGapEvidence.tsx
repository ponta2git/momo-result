import { Search } from "lucide-react";
import { useId } from "react";

import {
  formatGapRank,
  formatRankGap,
} from "@/features/seriesComparison/model/expectedRankGapPresentation";
import {
  formatDateTime,
  formatManYen,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesAnalysisDrilldownV3 } from "@/shared/api/seriesAnalysis";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

type EvidencePayload = Extract<
  SeriesAnalysisDrilldownV3["payload"],
  { kind: "expected_rank_gap_evidence" }
>;
type EvidenceRow = EvidencePayload["above"][number];

/**
 * Matches that finished furthest above and below their expected rank. The selection and order
 * come from the artifact; the saved note is display-only and never affects either.
 */
export function ExpectedRankGapEvidence({
  onFocusMatch,
  payload,
  playerName,
}: {
  onFocusMatch?: ((matchId: string) => void) | undefined;
  payload: EvidencePayload;
  playerName: string;
}) {
  return (
    <div className="grid gap-6">
      <FactList
        ariaLabel={`${playerName}の根拠の試合の要約`}
        columns={4}
        items={[
          { id: "player", label: "プレーヤー", value: playerName },
          { id: "target", label: "対象", value: `${payload.summary.matchCount}戦` },
          {
            id: "above",
            label: "見込みより上位",
            value: `${payload.summary.aboveCount}戦`,
          },
          {
            id: "below",
            label: "見込みより下位",
            value: `${payload.summary.belowCount}戦`,
          },
          ...(payload.summary.status === "reference"
            ? [
                {
                  id: "quality",
                  label: "注意",
                  value: <SeriesAnalysisQualityAdvisory status="reference" />,
                },
              ]
            : []),
        ]}
        layout="plain"
      />
      <div className="grid gap-8 lg:grid-cols-2">
        <EvidenceSide
          rows={payload.above}
          title="見込みより上位だった試合"
          total={payload.summary.aboveCount}
          onFocusMatch={onFocusMatch}
        />
        <EvidenceSide
          rows={payload.below}
          title="見込みより下位だった試合"
          total={payload.summary.belowCount}
          onFocusMatch={onFocusMatch}
        />
      </div>
    </div>
  );
}

function EvidenceSide({
  onFocusMatch,
  rows,
  title,
  total,
}: {
  onFocusMatch?: ((matchId: string) => void) | undefined;
  rows: readonly EvidenceRow[];
  title: string;
  total: number;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className={contentText.heading} id={headingId}>
          {title}
        </h3>
        {rows.length > 0 ? (
          <span className={cn(contentText.supporting, "tabular-nums")}>
            差の大きい{rows.length}戦（全{total}戦）
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className={contentText.body}>該当なし</p>
      ) : (
        <ol className="grid gap-5">
          {rows.map((row) => (
            <EvidenceItem key={row.matchId} row={row} onFocusMatch={onFocusMatch} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EvidenceItem({
  onFocusMatch,
  row,
}: {
  onFocusMatch?: ((matchId: string) => void) | undefined;
  row: EvidenceRow;
}) {
  const matchLabel = formatSeriesMatchIndex(row.matchIndex);
  return (
    <li className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <SeriesAnalysisMatchLink
          ariaLabel={`${matchLabel}の試合結果を開く`}
          matchId={row.matchId}
          presentation="text"
        >
          {matchLabel}
        </SeriesAnalysisMatchLink>
        <span className={cn(contentText.supporting, "tabular-nums")}>
          {formatDateTime(row.playedAt)}・{formatMatchNoInEvent(row.matchNoInEvent)}
        </span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
        <span className={contentText.compactPrimary}>実際 {row.actualRank}位</span>
        <span className={contentText.body}>
          見込み {formatGapRank(row.expectedRank)}・{formatRankGap(row.gap)}
        </span>
      </p>
      <FactList
        ariaLabel={`${matchLabel}の記録`}
        columns={4}
        items={[
          { id: "revenue-rank", label: "収益順位", value: `${row.revenueRank}位` },
          { id: "revenue", label: "物件収益", value: formatManYen(row.evidence.revenueManYen) },
          { id: "destination", label: "目的地", value: `${row.evidence.destinationCount}回` },
          { id: "card-shop", label: "カード売り場", value: `${row.evidence.cardShopCount}回` },
          { id: "plus", label: "プラス駅", value: `${row.evidence.plusStationCount}回` },
          { id: "card-station", label: "カード駅", value: `${row.evidence.cardStationCount}回` },
          { id: "minus", label: "マイナス駅", value: `${row.evidence.minusStationCount}回` },
          { id: "ginji", label: "スリの銀次", value: `${row.evidence.ginjiCount}回` },
        ]}
        layout="inline"
      />
      {row.note === null ? null : (
        <div className="grid gap-0.5">
          <p className={contentText.supporting}>試合メモ</p>
          <p className={cn(contentText.body, "break-words whitespace-pre-wrap")}>{row.note}</p>
        </div>
      )}
      {onFocusMatch ? (
        <div>
          <Button
            aria-label={`${matchLabel}をこのページで比較する`}
            icon={<Search aria-hidden="true" />}
            size="sm"
            variant="quiet"
            onClick={() => onFocusMatch(row.matchId)}
          >
            比較する
          </Button>
        </div>
      ) : null}
    </li>
  );
}
