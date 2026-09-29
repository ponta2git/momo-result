import { BookOpenText } from "lucide-react";

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
  return (
    <div className="grid min-w-0 gap-4">
      <p className={cn(contentText.body, readableTextWidthClass, "text-pretty")}>
        同じ記録を現行基準と候補で採点しています。点数の変化は採点基準の違いによるもので、成績の変化ではありません。
        適用すると、ここで選んだ条件だけでなく過去を含む作品全体の点数が変わります。
      </p>
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
      />
      {updating ? (
        <p className={contentText.body} role="status">
          選択した条件の比較を読み込み中です。
        </p>
      ) : null}
      <div aria-busy={updating || undefined} className="grid min-w-0 gap-4">
        {preview.evaluationState === "loading" ? (
          <Skeleton className="h-48 w-full" />
        ) : preview.evaluationState === "awaiting_analysis" ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
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
            {hasReferenceScores ? (
              <p className={cn(contentText.body, readableTextWidthClass)}>
                {referenceReasons.length > 0
                  ? `${referenceReasons.join("・")}のため、点数を参考値として表示しています。`
                  : "参考値の点数を含みます。"}
              </p>
            ) : null}
            <p className={cn(contentText.supporting, readableTextWidthClass)}>
              各欄の上段は現行基準から候補への点数の変化、下段は同じ記録から集計した元の成績です。
            </p>
            <DataTable
              caption={{ content: "採点基準変更前後の比較" }}
              density="compact"
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
                  minWidth: "12rem",
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
                        <p>{formatPlayerRadarRawValue(axis.id, after?.rawValue ?? null)}</p>
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
        ariaLabel="レーダー比較の読み方・対象記録・採点境界"
        summary={
          <span className="inline-flex items-center gap-2">
            <BookOpenText aria-hidden="true" className="size-4" />
            読み方・対象記録・採点境界
          </span>
        }
        panelSpacing="md"
        panelPadding="sm"
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
          {preview.after ? (
            <FactList
              ariaLabel="比較に使った記録の範囲"
              columns={2}
              items={[
                {
                  id: "period",
                  label: "比較対象の期間",
                  value:
                    preview.after.sample.firstPlayedAt && preview.after.sample.lastPlayedAt
                      ? `${formatDateTimeLong(preview.after.sample.firstPlayedAt)}〜${formatDateTimeLong(preview.after.sample.lastPlayedAt)}`
                      : "未取得",
                },
                {
                  id: "maps",
                  label: "比較対象のマップ別件数",
                  value:
                    preview.after.sample.maps
                      .map((map) => `${map.displayName} ${map.matchCount}試合`)
                      .join("、") || "未取得",
                },
              ]}
            />
          ) : null}
          {[
            { id: "before", label: "現行基準", basis: preview.beforeBasis },
            { id: "candidate", label: "候補", basis: preview.candidateBasis },
          ].map(({ id, label, basis }) =>
            basis ? (
              <FactList
                ariaLabel={`${label}の作成元の範囲`}
                columns={2}
                key={id}
                items={[
                  {
                    id: "source-period",
                    label: `${label}を作った記録の期間`,
                    value:
                      basis.source.firstPlayedAt && basis.source.lastPlayedAt
                        ? `${formatDateTimeLong(basis.source.firstPlayedAt)}〜${formatDateTimeLong(basis.source.lastPlayedAt)}`
                        : "未取得",
                  },
                  {
                    id: "source-maps",
                    label: `${label}を作った記録のマップ別件数`,
                    value:
                      basis.source.maps
                        .map((map) => `${map.displayName} ${map.matchCount}試合`)
                        .join("、") || "未取得",
                  },
                ]}
              />
            ) : null,
          )}
          <div className="grid min-w-0 gap-2">
            <DataTable
              caption={{ content: "現行と候補の採点境界" }}
              density="compact"
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
                          現行{" "}
                          {before ? formatPlayerRadarBoundary(axis.id, before.rawValue) : "未適用"}
                        </p>
                        <p>
                          候補{" "}
                          {after ? formatPlayerRadarBoundary(axis.id, after.rawValue) : "未作成"}
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
            <p className={cn(contentText.supporting, readableTextWidthClass)}>
              「約」は表示用に丸めた境界です。採点には丸める前の値を使います。
            </p>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
