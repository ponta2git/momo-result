import { useEffect, useRef } from "react";

import type {
  PlayerRadarRevision,
  PlayerRadarRevisionDetail,
} from "@/shared/api/seriesPlayerRadarHistory";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import {
  playerRadarSettingAxes,
  achievementScorePoints,
  defaultAchievementCurve,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { DataTable } from "@/shared/ui/data/DataTable";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";

export const playerRadarRevisionKind = {
  generated: "自動提案",
  manual: "手調整",
  restore: "復帰",
} as const;

export function playerRadarRevisionActor(actor: PlayerRadarRevision["appliedBy"]) {
  return actor.displayName ?? `当時の表示名なし（${actor.accountId}）`;
}

export function PlayerRadarHistoryDetail({ detail }: { detail: PlayerRadarRevisionDetail }) {
  const { revision, beforeBasis, afterBasis } = detail;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The list action disappears when its detail opens. Preserve any focus the
    // user has deliberately moved while the request was in flight.
    if (document.activeElement === document.body) headingRef.current?.focus();
  }, []);
  return (
    <section aria-label="改訂詳細" className="grid min-w-0 grid-cols-1 gap-4">
      <div className="grid gap-1">
        <h3 ref={headingRef} tabIndex={-1} className={contentText.heading}>
          {revision.gameTitleName} · {playerRadarRevisionKind[revision.kind]}
        </h3>
        <p className={contentText.body}>{formatDateTimeLong(revision.appliedAt)} 適用</p>
        <p className={contentText.body}>適用者: {playerRadarRevisionActor(revision.appliedBy)}</p>
        <p className={contentText.body}>
          案の保存者:{" "}
          {revision.savedBy ? playerRadarRevisionActor(revision.savedBy) : "当時の情報なし"}
        </p>
      </div>
      {beforeBasis ? null : (
        <p className={contentText.body}>
          成績6軸の初回適用です。実績達成の変更前には初期値を使います。
        </p>
      )}
      <TabsRoot defaultValue="averageRank" key={revision.revisionId}>
        <TabsList aria-label="改訂詳細の軸" variant="underline">
          {playerRadarSettingAxes.map((axis) => (
            <TabsTab value={axis.id} key={axis.id}>
              {axis.label}
            </TabsTab>
          ))}
        </TabsList>
        {playerRadarSettingAxes.map((axis) => {
          const before = beforeBasis?.axes.find((entry) => entry.axisId === axis.id);
          const after = afterBasis.axes.find((entry) => entry.axisId === axis.id);
          const unit =
            axis.id === "achievement" ? "%" : axis.id === "averageRank" ? "位以下" : "万円以上";
          const rows: Array<{
            score: number;
            before: number | undefined;
            after: number | undefined;
          }> =
            axis.id === "achievement"
              ? achievementScorePoints.map((score, index) => ({
                  score,
                  before: (detail.beforeAchievementCurve ?? defaultAchievementCurve).thresholds[
                    index
                  ],
                  after: detail.afterAchievementCurve.thresholds[index],
                }))
              : Array.from({ length: 9 }, (_, index) => ({
                  score: index + 2,
                  before: before?.thresholds[index],
                  after: after?.thresholds[index],
                }));
          return (
            <TabsPanel value={axis.id} key={axis.id}>
              <div className="mt-4 min-w-0">
                <DataTable
                  caption={{ content: `${axis.label}の改訂前後の採点境界` }}
                  rows={rows}
                  getRowKey={(row) => String(row.score)}
                  columns={[
                    {
                      key: "score",
                      minWidth: "4rem",
                      header: "点数",
                      rowHeader: true,
                      tabular: true,
                      renderCell: (row) => `${row.score}点`,
                    },
                    {
                      key: "before",
                      minWidth: "10rem",
                      header: `変更前（${unit}）`,
                      tabular: true,
                      renderCell: (row) =>
                        row.before === undefined ? "未適用" : String(row.before),
                    },
                    {
                      key: "after",
                      minWidth: "10rem",
                      header: `変更後（${unit}）`,
                      tabular: true,
                      renderCell: (row) =>
                        row.after === undefined ? "記録なし" : String(row.after),
                    },
                    {
                      key: "change",
                      minWidth: "6rem",
                      header: "差分",
                      renderCell: (row) =>
                        row.before === undefined
                          ? "新規"
                          : row.before === row.after
                            ? "変更なし"
                            : "変更あり",
                    },
                  ]}
                  density="compact"
                />
              </div>
            </TabsPanel>
          );
        })}
      </TabsRoot>
    </section>
  );
}
