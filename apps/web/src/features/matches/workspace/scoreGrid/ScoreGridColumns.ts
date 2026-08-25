import { incidentColumns } from "@/shared/domain/incidents";
import type { IncidentKey, IncidentLabel } from "@/shared/domain/incidents";
import { workspaceInputMembers } from "@/shared/domain/members";
import { fieldControlClass } from "@/shared/ui/forms/controlStyles";

export type GridColumn =
  | "memberId"
  | "playOrder"
  | "rank"
  | "totalAssetsManYen"
  | "revenueManYen"
  | `incident.${IncidentKey}`;

export type ScoreGridColumnDescriptor =
  | {
      column: Exclude<GridColumn, `incident.${IncidentKey}`>;
      header: string;
      kind: "member" | "numeric" | "select";
      widthClass: string;
    }
  | {
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

export const scoreGridColumns: ScoreGridColumnDescriptor[] = [
  { column: "memberId", header: "メンバー", kind: "member", widthClass: "w-[10rem]" },
  { column: "playOrder", header: "順", kind: "select", widthClass: "w-[7ch]" },
  { column: "rank", header: "順位", kind: "numeric", widthClass: "w-[7ch]" },
  {
    column: "totalAssetsManYen",
    header: "総資産（万円）",
    kind: "numeric",
    widthClass: "w-[14ch]",
  },
  { column: "revenueManYen", header: "収益（万円）", kind: "numeric", widthClass: "w-[14ch]" },
  ...incidentColumns.map(([incidentKey, header]): ScoreGridColumnDescriptor => ({
    column: `incident.${incidentKey}`,
    header,
    incidentKey,
    kind: "incident",
    widthClass: "w-[7ch]",
  })),
];

export const gridColumns = scoreGridColumns.map((column) => column.column);
export const incidentScoreGridColumns = scoreGridColumns.filter(isIncidentScoreGridColumn);

export function playerSlotKey(index: number): string {
  return workspaceInputMembers[index]?.memberId ?? `extra-player-${index}`;
}

export const baseInputClass = `${fieldControlClass} px-2`;
export const textNumericShortClass = `${baseInputClass} min-w-[6ch] text-center tabular-nums`;
export const textNumericClass = `${baseInputClass} min-w-[12ch] text-right tabular-nums`;
export const selectShortClass = `${baseInputClass} min-w-[6ch] text-center`;
export const memberSelectClass = `${baseInputClass} min-w-[10rem]`;
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
