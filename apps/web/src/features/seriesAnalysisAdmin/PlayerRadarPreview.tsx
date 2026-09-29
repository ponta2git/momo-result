import type {
  PlayerRadarPreviewFilter,
  PlayerRadarPreviewModel,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { PlayerRadarAxisLabel } from "@/shared/seriesAnalysis/PlayerRadarAxisLabel";
import {
  formatPlayerRadarBoundary,
  formatPlayerRadarRawValue,
  playerRadarAxes,
  playerRadarScoreLabel,
  playerRadarUnavailableLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { FactList } from "@/shared/ui/data/FactList";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { FilterBar } from "@/shared/ui/forms/FilterBar";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function PlayerRadarPreview({
  preview,
  filter,
  updating,
  onSeasonChange,
  onMapChange,
  onResetFilter,
}: {
  preview: PlayerRadarPreviewModel;
  filter: PlayerRadarPreviewFilter;
  updating: boolean;
  onSeasonChange: (value: string) => void;
  onMapChange: (value: string) => void;
  onResetFilter: () => void;
}) {
  const players = orderFixedMembers(preview.after?.players ?? []);
  const hasFilter = Boolean(filter.seasonMasterId || filter.mapMasterId);
  const hasReferenceScores = players.some((player) =>
    player.axes.some((axis) => axis.sampleQuality === "reference" && axis.score !== null),
  );
  const referenceReasons = preview.after
    ? [
        preview.after.sample.matchCount < 40 ? "40試合未満" : null,
        preview.after.sample.heldEventCount < 8 ? "8開催未満" : null,
      ].filter(Boolean)
    : [];
  const recordSources = [
    ...(preview.after
      ? [{ id: "evaluation", label: "比較対象", sample: preview.after.sample }]
      : []),
    ...(preview.beforeBasis
      ? [{ id: "before", label: "現行基準の作成元", sample: preview.beforeBasis.source }]
      : []),
    { id: "candidate", label: "候補の作成元", sample: preview.candidateBasis.source },
  ];
  return (
    <div className="grid min-w-0 gap-4">
      <FilterBar
        ariaLabel="採点基準の比較条件"
        primary={
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="比較するシーズン"
              options={filter.seasonOptions}
              value={filter.seasonMasterId}
              onValueChange={onSeasonChange}
            />
            <SelectField
              label="比較するマップ"
              options={filter.mapOptions}
              value={filter.mapMasterId}
              onValueChange={onMapChange}
            />
          </div>
        }
        resetAction={
          hasFilter && preview.evaluationState !== "empty" ? (
            <Button size="sm" variant="quiet" onClick={onResetFilter}>
              全期間・全マップで比較する
            </Button>
          ) : undefined
        }
        meta={
          preview.after
            ? `比較対象 ${preview.after.sample.matchCount}試合・${preview.after.sample.heldEventCount}開催`
            : undefined
        }
      />
      {updating ? (
        <p className={contentText.body} role="status">
          比較を読み込み中
        </p>
      ) : null}
      <div className="grid min-w-0">
        <div aria-busy={updating || undefined} className="grid min-w-0 gap-4">
          {preview.evaluationState === "loading" ? (
            <Skeleton className="h-48 w-full" />
          ) : preview.evaluationState === "awaiting_analysis" ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>比較は未計算です。</p>
          ) : preview.evaluationState === "error" ? (
            <Notice tone="warning" title="比較結果を読み込めません">
              「基準の状態を更新」から再読み込みしてください。
            </Notice>
          ) : preview.after ? (
            <>
              {hasReferenceScores ? (
                <p className={cn(contentText.body, readableTextWidthClass)}>
                  {referenceReasons.length > 0
                    ? `参考値（${referenceReasons.join("・")}）`
                    : "参考値を含みます。"}
                </p>
              ) : null}
              <DataTable
                caption={{ content: "採点基準変更前後の比較" }}
                density="compact"
                columns={[
                  {
                    header: "観点",
                    key: "axis",
                    rowHeader: true,
                    minWidth: "7rem",
                    renderCell: (axis) => <PlayerRadarAxisLabel label={axis.label} />,
                  },
                  ...players.map((player) => ({
                    header: (
                      <div className="grid gap-1">
                        <MemberSequenceLabel memberId={player.memberId}>
                          {player.displayName}
                        </MemberSequenceLabel>
                        <span className="whitespace-nowrap">現行 → 候補</span>
                      </div>
                    ),
                    key: player.memberId,
                    minWidth: "8.5rem",
                    tabular: true,
                    renderCell: (axis: (typeof playerRadarAxes)[number]) => {
                      const before = preview.before?.players
                        .find((entry) => entry.memberId === player.memberId)
                        ?.axes.find((cell) => cell.axisId === axis.id);
                      const after = player.axes.find((cell) => cell.axisId === axis.id);
                      return (
                        <div className="grid gap-1">
                          <p className="whitespace-nowrap">
                            <span className="sr-only">現行 </span>
                            {playerRadarScoreLabel(before)} <span aria-label="変更後">→</span>{" "}
                            <span className="sr-only">候補 </span>
                            <span className={contentText.compactPrimary}>
                              {playerRadarScoreLabel(after)}
                            </span>
                          </p>
                          <p className="whitespace-nowrap">
                            <span className="sr-only">元の成績 </span>
                            {formatPlayerRadarRawValue(axis.id, after?.rawValue ?? null)}
                          </p>
                          {after?.sampleQuality === "reference" && after.score !== null ? (
                            <p className={contentText.supporting}>参考値</p>
                          ) : null}
                          {after?.scoreUnavailableReasons.length ? (
                            <p className={contentText.supporting}>
                              {after.scoreUnavailableReasons
                                .map(playerRadarUnavailableLabel)
                                .join("・")}
                            </p>
                          ) : null}
                        </div>
                      );
                    },
                  })),
                ]}
                getRowKey={(axis) => axis.id}
                rows={[...playerRadarAxes]}
                stickyRowHeader
                verticalAlign="top"
              />
            </>
          ) : (
            <EmptyState
              placement="embedded"
              title="この条件に対象試合はありません"
              description="シーズン・マップを変更して比較してください。"
              action={
                <Button variant="secondary" onClick={onResetFilter}>
                  全期間・全マップで比較する
                </Button>
              }
            />
          )}
        </div>
        <Disclosure
          summary="採点基準と対象記録"
          triggerLayout="flush-horizontal"
          triggerVariant="supporting"
        >
          <div className="grid min-w-0 gap-6">
            <FactList
              ariaLabel="6つの観点の意味"
              columns={2}
              items={playerRadarAxes.map((axis) => ({
                id: axis.id,
                label: axis.label,
                value: axis.description,
              }))}
            />
            <div className="grid min-w-0 gap-4">
              <FactList
                ariaLabel="比較の計算時点"
                items={[
                  {
                    id: "created",
                    label: "比較計算日時",
                    value: formatDateTimeLong(preview.createdAt),
                  },
                ]}
              />
              <DataTable
                caption={{ content: "集計に使った記録" }}
                columns={[
                  {
                    key: "source",
                    header: "記録",
                    rowHeader: true,
                    minWidth: "9rem",
                    renderCell: (entry) => entry.label,
                  },
                  {
                    key: "sample",
                    header: "件数",
                    minWidth: "8rem",
                    tabular: true,
                    renderCell: (entry) =>
                      `${entry.sample.matchCount}試合・${entry.sample.heldEventCount}開催`,
                  },
                  {
                    key: "period",
                    header: "期間",
                    minWidth: "18rem",
                    tabular: true,
                    renderCell: (entry) =>
                      entry.sample.firstPlayedAt && entry.sample.lastPlayedAt
                        ? `${formatDateTimeLong(entry.sample.firstPlayedAt)}〜${formatDateTimeLong(entry.sample.lastPlayedAt)}`
                        : "未取得",
                  },
                  {
                    key: "maps",
                    header: "マップ別件数",
                    minWidth: "12rem",
                    tabular: true,
                    renderCell: (entry) =>
                      entry.sample.maps
                        .map((map) => `${map.displayName} ${map.matchCount}試合`)
                        .join("、") || "未取得",
                  },
                ]}
                density="compact"
                getRowKey={(entry) => entry.id}
                rows={recordSources}
                stickyRowHeader
                verticalAlign="top"
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <DataTable
                caption={{ content: "採点境界（現行 → 候補）", visibility: "visible" }}
                density="compact"
                columns={[
                  {
                    header: "観点",
                    key: "axis",
                    rowHeader: true,
                    minWidth: "9rem",
                    renderCell: (axis) => <PlayerRadarAxisLabel label={axis.label} />,
                  },
                  ...Array.from({ length: 9 }, (_, index) => index + 2).map((score) => ({
                    header: `${score}点`,
                    key: `score-${score}`,
                    tabular: true,
                    minWidth: "12rem",
                    renderCell: (axis: (typeof playerRadarAxes)[number]) => {
                      const before = preview.beforeBasis?.axes
                        .find((entry) => entry.axisId === axis.id)
                        ?.thresholds.find((entry) => entry.score === score);
                      const after = preview.candidateBasis.axes
                        .find((entry) => entry.axisId === axis.id)
                        ?.thresholds.find((entry) => entry.score === score);
                      return (
                        <p>
                          <span className="inline-block whitespace-nowrap">
                            <span className="sr-only">現行 </span>
                            {before
                              ? formatPlayerRadarBoundary(axis.id, before.rawValue)
                              : "未適用"}
                          </span>
                          <span aria-label="変更後"> → </span>
                          <span className="inline-block whitespace-nowrap">
                            <span className="sr-only">候補 </span>
                            {after ? formatPlayerRadarBoundary(axis.id, after.rawValue) : "未作成"}
                          </span>
                        </p>
                      );
                    },
                  })),
                ]}
                getRowKey={(axis) => axis.id}
                rows={[...playerRadarAxes]}
                stickyRowHeader
                verticalAlign="top"
              />
              <p className={cn(contentText.supporting, readableTextWidthClass)}>
                「約」は表示用の丸めです。採点は元の値を使います。
              </p>
            </div>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}
