import type { MasterViewModelInput } from "@/features/masters/masterTypes";

export function buildMasterViewModel({
  gameTitles,
  mapMasters,
  seasonMasters,
  selectedGameTitleId,
}: MasterViewModelInput) {
  const selectedGameTitle = gameTitles.find((item) => item.id === selectedGameTitleId);
  const selectedId = selectedGameTitle?.id ?? "";
  const selectedMapMasters = selectedId
    ? mapMasters.filter((item) => item.gameTitleId === selectedId)
    : [];
  const selectedSeasonMasters = selectedId
    ? seasonMasters.filter((item) => item.gameTitleId === selectedId)
    : [];

  return {
    canCreateScopedMasters: Boolean(selectedGameTitle),
    scopedDisabledReason: selectedGameTitle
      ? undefined
      : "先に作品マスタを追加してください。マップとシーズンは作品に紐づきます。",
    selectedGameTitle,
    selectedGameTitleId: selectedId,
    selectedMapMasters,
    selectedSeasonMasters,
    shouldPromptGameTitleCreation: gameTitles.length === 0,
  };
}
