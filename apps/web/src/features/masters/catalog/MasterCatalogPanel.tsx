import type { MasterCatalogView } from "@/features/masters/catalog/catalogTypes";
import { GameTitleCreateDialog, GameTitleList } from "@/features/masters/catalog/GameTitleList";
import { ScopedMasterPanel } from "@/features/masters/catalog/ScopedMasterPanel";
import { PendingStatus } from "@/shared/ui/feedback/PendingStatus";

const mapPanelLabels = {
  title: "マップ",
  itemLabel: "マップ",
};
const seasonPanelLabels = {
  title: "シーズン",
  itemLabel: "シーズン",
};

/**
 * The selected title's map and season status shares the title header with the add action, so
 * reserving it never adds space between the title choices and the map and season panels.
 */
export function MasterCatalogActions({
  gameTitle,
  map,
  season,
}: Pick<MasterCatalogView, "gameTitle" | "map" | "season">) {
  return (
    <>
      <PendingStatus
        pending={Boolean((map.list.loading || season.list.loading) && !gameTitle.create.pending)}
      >
        選択した作品の設定を読み込み中
      </PendingStatus>
      {gameTitle.canEdit ? (
        <GameTitleCreateDialog
          key={gameTitle.create.formKey}
          create={gameTitle.create}
          defaultLayoutFamily={gameTitle.defaultLayoutFamily}
        />
      ) : null}
    </>
  );
}

export function MasterCatalogPanel({
  gameTitle,
  map,
  scopedDisabledReason,
  season,
}: MasterCatalogView) {
  return (
    <div className="grid min-w-0 gap-6">
      <GameTitleList {...gameTitle} />

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <ScopedMasterPanel
            {...map}
            labels={mapPanelLabels}
            disabledReason={scopedDisabledReason}
          />
        </div>

        <div className="min-w-0">
          <ScopedMasterPanel
            {...season}
            labels={seasonPanelLabels}
            disabledReason={scopedDisabledReason}
          />
        </div>
      </div>
    </div>
  );
}
