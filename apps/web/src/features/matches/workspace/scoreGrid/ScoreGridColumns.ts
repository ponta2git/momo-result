import { incidentColumns } from "@/shared/domain/incidents";
import type { IncidentKey, IncidentLabel } from "@/shared/domain/incidents";
import { fixedMembers } from "@/shared/domain/members";

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
  { column: "totalAssetsManYen", header: "総資産", kind: "numeric", widthClass: "w-[12ch]" },
  { column: "revenueManYen", header: "収益", kind: "numeric", widthClass: "w-[12ch]" },
  ...incidentColumns.map(
    ([incidentKey, header]): ScoreGridColumnDescriptor => ({
      column: `incident.${incidentKey}`,
      header,
      incidentKey,
      kind: "incident",
      widthClass: "w-[7ch]",
    }),
  ),
];

export const gridColumns = scoreGridColumns.map((column) => column.column);
export const incidentScoreGridColumns = scoreGridColumns.filter(isIncidentScoreGridColumn);

export function playerSlotKey(index: number): string {
  return fixedMembers[index]?.memberId ?? `extra-player-${index}`;
}

export const baseInputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text-primary)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]";
export const textNumericShortClass = `${baseInputClass} min-w-[6ch] text-center tabular-nums`;
export const textNumericClass = `${baseInputClass} min-w-[12ch] text-right tabular-nums`;
export const selectShortClass = `${baseInputClass} min-w-[6ch] text-center`;
export const memberSelectClass = `${baseInputClass} min-w-[10rem]`;
export const playerFieldLabels = {
  rank: "順位",
  revenueManYen: "収益",
  totalAssetsManYen: "総資産",
} as const satisfies Record<"rank" | "revenueManYen" | "totalAssetsManYen", string>;

export function keyToPath(row: number, column: GridColumn): string {
  if (column.startsWith("incident.")) {
    return `players.${row}.incidents.${column.replace("incident.", "")}`;
  }
  return `players.${row}.${column}`;
}
