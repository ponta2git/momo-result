import type {
  GameTitleListResponse,
  MapMasterListResponse,
  SeasonMasterListResponse,
} from "@/shared/api/masters";

function byDisplayOrder<T extends { displayOrder: number; name: string }>(a: T, b: T): number {
  return a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "ja");
}

export const selectGameTitles = (response: GameTitleListResponse) =>
  (response.items ?? []).toSorted(byDisplayOrder);
export const selectMapMasters = (response: MapMasterListResponse) =>
  (response.items ?? []).toSorted(byDisplayOrder);
export const selectSeasonMasters = (response: SeasonMasterListResponse) =>
  (response.items ?? []).toSorted(byDisplayOrder);
