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
      widthClass: string;
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
 * The fixed table layout shares its width in these proportions. They add up to just under the
 * 64rem minimum, where each column still fits its one-line header and its control, so wider
 * tables only add room. Incident columns follow the length of their labels.
 */
const incidentWidthClass = {
  destination: "w-[4.5rem]",
  plusStation: "w-[4.5rem]",
  minusStation: "w-[5rem]",
  cardStation: "w-[4.5rem]",
  cardShop: "w-[6rem]",
  suriNoGinji: "w-[5rem]",
} as const satisfies Record<IncidentKey, string>;

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
    widthClass: incidentWidthClass[incidentKey],
  })),
];

export const gridColumns = scoreGridColumns.map((column) => column.column);
export const incidentScoreGridColumns = scoreGridColumns.filter(isIncidentScoreGridColumn);

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
