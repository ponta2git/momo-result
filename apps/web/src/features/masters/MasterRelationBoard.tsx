import { GameTitleList } from "@/features/masters/GameTitleList";
import { ScopedMasterPanel } from "@/features/masters/ScopedMasterPanel";
import type { LayoutFamily } from "@/shared/api/enums";
import type {
  GameTitleResponse,
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
  onDeleteGameTitle: (id: string) => Promise<void> | void;
  onDeleteMapMaster: (id: string) => Promise<void> | void;
  onDeleteSeasonMaster: (id: string) => Promise<void> | void;
  mapCreateAction: (formData: FormData) => void | Promise<void>;
  mapCreateError?: string | undefined;
  mapCreateFormKey?: string | number | undefined;
  mapMasters: ScopedMasterListItem[];
  onSelectGameTitle: (id: string) => void;
  onUpdateGameTitle: (id: string, request: { name: string; layoutFamily: string }) => Promise<void>;
  onUpdateMapMaster: (id: string, request: { name: string }) => Promise<void>;
  onUpdateSeasonMaster: (id: string, request: { name: string }) => Promise<void>;
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
  onDeleteGameTitle,
  onDeleteMapMaster,
  onDeleteSeasonMaster,
  mapCreateAction,
  mapCreateError,
  mapCreateFormKey,
  mapMasters,
  onSelectGameTitle,
  onUpdateGameTitle,
  onUpdateMapMaster,
  onUpdateSeasonMaster,
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
        onDelete={onDeleteGameTitle}
        onUpdate={onUpdateGameTitle}
        onSelect={onSelectGameTitle}
        selectedGameTitleId={selectedGameTitleId}
      />

      <ScopedMasterPanel
        title="マップ"
        itemLabel="マップ"
        items={mapMasters}
        onDelete={onDeleteMapMaster}
        onUpdate={onUpdateMapMaster}
        selectedGameTitleName={selectedGameTitleName}
        emptyDescription="この作品に紐づくマップを追加してください。"
        createAction={mapCreateAction}
        createError={mapCreateError}
        createFormKey={mapCreateFormKey}
        disabledReason={scopedDisabledReason}
      />

      <ScopedMasterPanel
        title="シーズン"
        itemLabel="シーズン"
        items={seasonMasters}
        onDelete={onDeleteSeasonMaster}
        onUpdate={onUpdateSeasonMaster}
        selectedGameTitleName={selectedGameTitleName}
        emptyDescription="この作品に紐づくシーズンを追加してください。"
        createAction={seasonCreateAction}
        createError={seasonCreateError}
        createFormKey={seasonCreateFormKey}
        disabledReason={scopedDisabledReason}
      />
    </section>
  );
}
