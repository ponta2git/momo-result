import { incidentColumns } from "@/shared/domain/incidents";
import type { IncidentKey, IncidentLabel } from "@/shared/domain/incidents";
import { workspaceInputMembers } from "@/shared/domain/members";

export type GridColumn =
  | "memberId"
  | "playOrder"
  | "rank"
  | "totalAssetsManYen"
  | "revenueManYen"
  | `incident.${IncidentKey}`;

/** Headers follow the alignment of the values in their column. */
export type ScoreGridColumnAlign = "start" | "center" | "end";

export type ScoreGridColumnDescriptor =
  | {
      align: ScoreGridColumnAlign;
      column: Exclude<GridColumn, `incident.${IncidentKey}`>;
      header: string;
      kind: "member" | "numeric" | "select";
      widthClass: string;
    }
  | {
      align: ScoreGridColumnAlign;
      column: `incident.${IncidentKey}`;
      header: IncidentLabel;
      incidentKey: IncidentKey;
      kind: "incident";
    };
export type IncidentScoreGridColumnDescriptor = Extract<
  ScoreGridColumnDescriptor,
  { kind: "incident" }
>;

function isIncidentScoreGridColumn(
  column: ScoreGridColumnDescriptor,
): column is IncidentScoreGridColumnDescriptor {
  return column.kind === "incident";
}

/**
 * The fixed table layout shares its width in these proportions. The player columns add up to
 * the width where each still fits its one-line header and its control. Incident counts share
 * one column: in a table as wide as the one-line layout they sit side by side under their own
 * headers, and in a narrower one they fold into two lines of three with their names beside each
 * input, so the table fits next to the source image (UI rule: 編集中の field と照合する画像の
 * 該当箇所を同時に見られる配置).
 */
export const scoreGridContainerClass = "@container/score-grid";
/**
 * Each count gets 4.5rem, enough for its longest name and for an error-sized「未読み取り」:
 * six across with their gaps take 33rem, three across 16.5rem.
 */
export const scoreGridTableWidthClass = "min-w-[50.5rem] @min-[67rem]/score-grid:min-w-[67rem]";
export const incidentScoreGridColumnWidthClass = "w-[16.5rem] @min-[67rem]/score-grid:w-[33rem]";
/** Header and cells share one template so each count stays under its own name. */
export const incidentScoreGridLayoutClass =
  "grid grid-cols-3 gap-x-4 gap-y-2 @min-[67rem]/score-grid:grid-cols-6";
/** Names shown beside each count only while the counts are folded. */
export const incidentScoreGridInlineLabelClass = "@min-[67rem]/score-grid:hidden";
export const incidentScoreGridHeaderLabelsClass = "hidden @min-[67rem]/score-grid:grid";
export const incidentScoreGridHeaderGroupClass = "@min-[67rem]/score-grid:sr-only";

export const scoreGridColumns: ScoreGridColumnDescriptor[] = [
  {
    align: "start",
    column: "memberId",
    header: "メンバー",
    kind: "member",
    widthClass: "w-[8.5rem]",
  },
  {
    align: "center",
    column: "playOrder",
    header: "プレー順",
    kind: "select",
    widthClass: "w-[5.5rem]",
  },
  { align: "center", column: "rank", header: "順位", kind: "numeric", widthClass: "w-[4.75rem]" },
  {
    align: "end",
    column: "totalAssetsManYen",
    header: "総資産（万円）",
    kind: "numeric",
    widthClass: "w-[7.5rem]",
  },
  {
    align: "end",
    column: "revenueManYen",
    header: "収益（万円）",
    kind: "numeric",
    widthClass: "w-[7.5rem]",
  },
  ...incidentColumns.map(([incidentKey, header]): ScoreGridColumnDescriptor => ({
    align: "center",
    column: `incident.${incidentKey}`,
    header,
    incidentKey,
    kind: "incident",
  })),
];

export const gridColumns = scoreGridColumns.map((column) => column.column);
export const incidentScoreGridColumns = scoreGridColumns.filter(isIncidentScoreGridColumn);
export const playerScoreGridColumns = scoreGridColumns.filter(
  (column): column is Exclude<ScoreGridColumnDescriptor, { kind: "incident" }> =>
    !isIncidentScoreGridColumn(column),
);

export function playerSlotKey(index: number): string {
  return workspaceInputMembers[index]?.memberId ?? `extra-player-${index}`;
}

export const playerFieldLabels = {
  rank: "順位",
  revenueManYen: "収益（万円）",
  totalAssetsManYen: "総資産（万円）",
} as const satisfies Record<"rank" | "revenueManYen" | "totalAssetsManYen", string>;

export function keyToPath(row: number, column: GridColumn): string {
  if (column.startsWith("incident.")) {
    return `players.${row}.incidents.${column.replace("incident.", "")}`;
  }
  return `players.${row}.${column}`;
}
