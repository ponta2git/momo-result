import type { MasterCatalogView } from "@/features/masters/catalog/catalogTypes";
import { GameTitleList } from "@/features/masters/catalog/GameTitleList";
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

export function MasterCatalogPanel({
  gameTitle,
  map,
  scopedDisabledReason,
  season,
}: MasterCatalogView) {
  return (
    <section className="grid gap-6">
      <GameTitleList {...gameTitle} />

      <div>
        <PendingStatus
          pending={Boolean((map.list.loading || season.list.loading) && !gameTitle.create.pending)}
        >
          選択した作品の設定を読み込み中
        </PendingStatus>
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
    </section>
  );
}
