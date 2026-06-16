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
      : "作品を追加すると、マップとシーズンを登録できます。",
    selectedGameTitle,
    selectedGameTitleId: selectedId,
    selectedMapMasters,
    selectedSeasonMasters,
    shouldPromptGameTitleCreation: gameTitles.length === 0,
  };
}
