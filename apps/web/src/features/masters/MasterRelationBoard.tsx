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

type GameTitleListItem = GameTitleResponse & { pending?: boolean };
type ScopedMasterListItem = (MapMasterResponse | SeasonMasterResponse) & { pending?: boolean };

type MasterRelationBoardProps = {
  gameTitleCreateAction: (formData: FormData) => void | Promise<void>;
  gameTitleCreateError?: string | undefined;
  gameTitleCreateFormKey?: string | number | undefined;
  gameTitleDefaultLayoutFamily: LayoutFamily;
  gameTitles: GameTitleListItem[];
  incidentMasters: IncidentMasterResponse[];
  mapCreateAction: (formData: FormData) => void | Promise<void>;
  mapCreateError?: string | undefined;
  mapCreateFormKey?: string | number | undefined;
  mapMasters: ScopedMasterListItem[];
  onSelectGameTitle: (id: string) => void;
  scopedDisabledReason?: string | undefined;
  seasonCreateAction: (formData: FormData) => void | Promise<void>;
  seasonCreateError?: string | undefined;
  seasonCreateFormKey?: string | number | undefined;
  seasonMasters: ScopedMasterListItem[];
  selectedGameTitleId: string;
  selectedGameTitleName?: string | undefined;
};

export function MasterRelationBoard({
  gameTitleCreateAction,
  gameTitleCreateError,
  gameTitleCreateFormKey,
  gameTitleDefaultLayoutFamily,
  gameTitles,
  incidentMasters,
  mapCreateAction,
  mapCreateError,
  mapCreateFormKey,
  mapMasters,
  onSelectGameTitle,
  scopedDisabledReason,
  seasonCreateAction,
  seasonCreateError,
  seasonCreateFormKey,
  seasonMasters,
  selectedGameTitleId,
  selectedGameTitleName,
}: MasterRelationBoardProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(16rem,1fr)_minmax(18rem,1fr)_minmax(18rem,1fr)]">
      <GameTitleList
        createAction={gameTitleCreateAction}
        createError={gameTitleCreateError}
        createFormKey={gameTitleCreateFormKey}
        defaultLayoutFamily={gameTitleDefaultLayoutFamily}
        items={gameTitles}
        onSelect={onSelectGameTitle}
        selectedGameTitleId={selectedGameTitleId}
      />

      <ScopedMasterPanel
        title="マップマスタ"
        itemLabel="マップ"
        items={mapMasters}
        selectedGameTitleName={selectedGameTitleName}
        emptyDescription="この作品に紐づくマップを追加してください。"
        createAction={mapCreateAction}
        createError={mapCreateError}
        createFormKey={mapCreateFormKey}
        disabledReason={scopedDisabledReason}
      />

      <ScopedMasterPanel
        title="シーズンマスタ"
        itemLabel="シーズン"
        items={seasonMasters}
        selectedGameTitleName={selectedGameTitleName}
        emptyDescription="この作品に紐づくシーズンを追加してください。"
        createAction={seasonCreateAction}
        createError={seasonCreateError}
        createFormKey={seasonCreateFormKey}
        disabledReason={scopedDisabledReason}
      />

      <div className="xl:col-span-3">
        <IncidentMasterPanel items={incidentMasters} />
      </div>
    </section>
  );
}
