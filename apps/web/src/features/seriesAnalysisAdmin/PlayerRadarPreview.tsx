import type {
  PlayerRadarPreviewFilter,
  PlayerRadarPreviewModel,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { PlayerRadarAxisLabel } from "@/shared/seriesAnalysis/PlayerRadarAxisLabel";
import {
  formatPlayerRadarRawValue,
  playerRadarAxes,
  playerRadarScoreLabel,
  playerRadarScoresAreReference,
  playerRadarUnavailableLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarCell } from "@/shared/seriesAnalysis/playerRadarPresentation";
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

function isReferenceScore(cell: PlayerRadarCell | undefined): boolean {
  return cell?.sampleQuality === "reference" && cell.score !== null;
}

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
  const allScoresReference = playerRadarScoresAreReference([
    ...(preview.before?.players ?? []),
    ...players,
  ]);
  const referenceReasons = preview.after
    ? [
        preview.after.sample.matchCount < 40 ? "40試合未満" : null,
        preview.after.sample.heldEventCount < 8 ? "8開催未満" : null,
      ].filter(Boolean)
    : [];
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
              {allScoresReference ? (
                <p className={cn(contentText.body, readableTextWidthClass)}>
                  {referenceReasons.length > 0
                    ? `参考値（${referenceReasons.join("・")}）`
                    : "参考値"}
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
                        <span className="whitespace-nowrap">適用中 → 変更案</span>
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
                      const beforeReference = isReferenceScore(before);
                      const afterReference = isReferenceScore(after);
                      return (
                        <div className="grid gap-1">
                          <p className="whitespace-nowrap">
                            <span className="sr-only">適用中 </span>
                            {playerRadarScoreLabel(before)} <span aria-label="変更後">→</span>{" "}
                            <span className="sr-only">変更案 </span>
                            <span className={contentText.compactPrimary}>
                              {playerRadarScoreLabel(after)}
                            </span>
                          </p>
                          <p className="whitespace-nowrap">
                            <span className="sr-only">元の成績 </span>
                            {formatPlayerRadarRawValue(axis.id, after?.rawValue ?? null)}
                          </p>
                          {!allScoresReference && (beforeReference || afterReference) ? (
                            <p className={contentText.supporting}>
                              {beforeReference && afterReference
                                ? "参考値"
                                : beforeReference
                                  ? "適用中: 参考値"
                                  : "変更案: 参考値"}
                            </p>
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
              action={
                <Button variant="secondary" onClick={onResetFilter}>
                  全期間・全マップで比較する
                </Button>
              }
            />
          )}
        </div>
        <Disclosure summary="点数の集計に使った記録" triggerVariant="supporting">
          <div className="px-3">
            <FactList
              ariaLabel="点数の集計に使った記録"
              columns={2}
              items={[
                {
                  id: "created",
                  label: "比較計算日時",
                  value: formatDateTimeLong(preview.createdAt),
                },
                ...(preview.after
                  ? [
                      {
                        id: "period",
                        label: "対象期間",
                        value:
                          preview.after.sample.firstPlayedAt && preview.after.sample.lastPlayedAt
                            ? `${formatDateTimeLong(preview.after.sample.firstPlayedAt)}〜${formatDateTimeLong(preview.after.sample.lastPlayedAt)}`
                            : "未取得",
                      },
                      {
                        id: "maps",
                        label: "マップ別件数",
                        value:
                          preview.after.sample.maps
                            .map((map) => `${map.displayName} ${map.matchCount}試合`)
                            .join("、") || "未取得",
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </Disclosure>
      </div>
    </div>
  );
}
