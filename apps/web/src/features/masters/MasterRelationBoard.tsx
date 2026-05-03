import { GameTitleList } from "@/features/masters/GameTitleList";
import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import { ScopedMasterPanel } from "@/features/masters/ScopedMasterPanel";
import type { LayoutFamily } from "@/shared/api/enums";
import type {
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

type MasterRelationBoardProps = {
  gameTitleCreateError?: string | undefined;
  gameTitleCreatePending?: boolean;
  gameTitleCreateValue: { layoutFamily: LayoutFamily; name: string };
  gameTitles: GameTitleResponse[];
  incidentMasters: IncidentMasterResponse[];
  mapCreateError?: string | undefined;
  mapCreatePending?: boolean;
  mapCreateValue: string;
  mapMasters: MapMasterResponse[];
  onChangeGameTitleCreateValue: (
    patch: Partial<{ layoutFamily: LayoutFamily; name: string }>,
  ) => void;
  onChangeMapCreateValue: (value: string) => void;
  onChangeSeasonCreateValue: (value: string) => void;
  onCreateGameTitle: () => void;
  onCreateMap: () => void;
  onCreateSeason: () => void;
  onSelectGameTitle: (id: string) => void;
  scopedDisabledReason?: string | undefined;
  seasonCreateError?: string | undefined;
  seasonCreatePending?: boolean;
  seasonCreateValue: string;
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
  selectedGameTitleName?: string | undefined;
};

export function MasterRelationBoard({
  gameTitleCreateError,
  gameTitleCreatePending = false,
  gameTitleCreateValue,
  gameTitles,
  incidentMasters,
  mapCreateError,
  mapCreatePending = false,
  mapCreateValue,
  mapMasters,
  onChangeGameTitleCreateValue,
  onChangeMapCreateValue,
  onChangeSeasonCreateValue,
  onCreateGameTitle,
  onCreateMap,
  onCreateSeason,
  onSelectGameTitle,
  scopedDisabledReason,
  seasonCreateError,
  seasonCreatePending = false,
  seasonCreateValue,
  seasonMasters,
  selectedGameTitleId,
  selectedGameTitleName,
}: MasterRelationBoardProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(16rem,1fr)_minmax(18rem,1fr)_minmax(18rem,1fr)]">
      <GameTitleList
        items={gameTitles}
        selectedGameTitleId={selectedGameTitleId}
        onSelect={onSelectGameTitle}
        createValue={gameTitleCreateValue}
        onChangeCreateValue={onChangeGameTitleCreateValue}
        onCreate={onCreateGameTitle}
        createPending={gameTitleCreatePending}
        createError={gameTitleCreateError}
      />

      <ScopedMasterPanel
        title="マップマスタ"
        itemLabel="マップ"
        items={mapMasters}
        selectedGameTitleName={selectedGameTitleName}
        emptyDescription="この作品に紐づくマップを追加してください。"
        createValue={mapCreateValue}
        onChangeCreateValue={onChangeMapCreateValue}
        onCreate={onCreateMap}
        createPending={mapCreatePending}
        createError={mapCreateError}
        disabledReason={scopedDisabledReason}
      />

      <ScopedMasterPanel
        title="シーズンマスタ"
        itemLabel="シーズン"
        items={seasonMasters}
        selectedGameTitleName={selectedGameTitleName}
        emptyDescription="この作品に紐づくシーズンを追加してください。"
        createValue={seasonCreateValue}
        onChangeCreateValue={onChangeSeasonCreateValue}
        onCreate={onCreateSeason}
        createPending={seasonCreatePending}
        createError={seasonCreateError}
        disabledReason={scopedDisabledReason}
      />

      <div className="xl:col-span-3">
        <IncidentMasterPanel items={incidentMasters} />
      </div>
    </section>
  );
}
