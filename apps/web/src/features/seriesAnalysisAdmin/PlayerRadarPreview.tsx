import type {
  PlayerRadarPreviewFilter,
  PlayerRadarPreviewModel,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
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
import { SelectField } from "@/shared/ui/forms/SelectField";
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
  return (
    <div className="grid min-w-0 gap-4">
      <p className={cn(contentText.body, "text-pretty")}>
        同じ記録を現行基準と候補で採点しています。点数の変化は採点基準の違いによるもので、成績の変化ではありません。
        適用すると、ここで選んだ条件だけでなく過去を含む作品全体の点数が変わります。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
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
      {updating ? (
        <p className={contentText.body} role="status">
          選択した条件の比較を読み込み中です。
        </p>
      ) : null}
      <div aria-busy={updating || undefined} className="grid min-w-0 gap-4">
        {preview.evaluationState === "loading" ? (
          <Skeleton className="h-48 w-full" />
        ) : preview.evaluationState === "awaiting_analysis" ? (
          <p className={contentText.body}>
            この条件の比較はまだ計算されていません。計算後に状態を更新してください。
          </p>
        ) : preview.evaluationState === "error" ? (
          <Notice tone="warning" title="比較結果を読み込めません">
            「基準の状態を更新」から再読み込みできます。採点基準は変更していません。
          </Notice>
        ) : preview.after ? (
          <>
            <FactList
              ariaLabel="比較に使った記録"
              columns={2}
              items={[
                {
                  id: "sample",
                  label: "比較対象",
                  value: `${preview.after.sample.matchCount}試合・${preview.after.sample.heldEventCount}開催`,
                },
                {
                  id: "created",
                  label: "比較計算日時",
                  value: formatDateTimeLong(preview.createdAt),
                },
              ]}
            />
            <DataTable
              caption={{ content: "採点基準変更前後の比較" }}
              columns={[
                {
                  header: "観点",
                  key: "axis",
                  rowHeader: true,
                  minWidth: "9rem",
                  renderCell: (axis) => axis.label,
                },
                ...players.map((player) => ({
                  header: (
                    <MemberSequenceLabel memberId={player.memberId}>
                      {player.displayName}
                    </MemberSequenceLabel>
                  ),
                  key: player.memberId,
                  minWidth: "14rem",
                  tabular: true,
                  renderCell: (axis: (typeof playerRadarAxes)[number]) => {
                    const before = preview.before?.players
                      .find((entry) => entry.memberId === player.memberId)
                      ?.axes.find((cell) => cell.axisId === axis.id);
                    const after = player.axes.find((cell) => cell.axisId === axis.id);
                    return (
                      <div className="grid gap-1">
                        <p>
                          現行 {playerRadarScoreLabel(before)} <span aria-label="変更後">→</span>{" "}
                          候補{" "}
                          <span className={contentText.compactPrimary}>
                            {playerRadarScoreLabel(after)}
                          </span>
                        </p>
                        <p>
                          元の成績 {formatPlayerRadarRawValue(axis.id, after?.rawValue ?? null)}
                        </p>
                        {after?.sampleQuality === "reference" && after.score !== null ? (
                          <p className={contentText.supporting}>参考</p>
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
            description="シーズン・マップの選択は保持しています。条件を変更すると別の記録で比較できます。"
            action={
              <Button variant="secondary" onClick={onResetFilter}>
                全期間・全マップで比較する
              </Button>
            }
          />
        )}
      </div>
      <Disclosure
        summary="現行と候補の採点境界を確認する"
        panelSpacing="md"
        triggerLayout="flush-horizontal"
      >
        <DataTable
          caption={{ content: "現行と候補の採点境界" }}
          columns={[
            {
              header: "観点",
              key: "axis",
              rowHeader: true,
              minWidth: "9rem",
              renderCell: (axis) => axis.label,
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
                  <div className="grid gap-1">
                    <p>
                      現行 {before ? formatPlayerRadarBoundary(axis.id, before.rawValue) : "未作成"}
                    </p>
                    <p>
                      候補 {after ? formatPlayerRadarBoundary(axis.id, after.rawValue) : "未作成"}
                    </p>
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
      </Disclosure>
    </div>
  );
}
