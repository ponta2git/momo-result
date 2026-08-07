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

type MasterCreateBinding = {
  action: (formData: FormData) => void | Promise<void>;
  error?: string | undefined;
  formKey?: string | number | undefined;
};

type GameTitleRelation = {
  create: MasterCreateBinding;
  defaultLayoutFamily: LayoutFamily;
  items: GameTitleListItem[];
  onDelete: (id: string) => Promise<void> | void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, request: { name: string; layoutFamily: string }) => Promise<void>;
  selectedId: string;
};

type ScopedMasterRelation = {
  create: MasterCreateBinding;
  error?: string | undefined;
  items: ScopedMasterListItem[];
  loading?: boolean | undefined;
  onRetry: () => void;
  onDelete: (id: string) => Promise<void> | void;
  onUpdate: (id: string, request: { name: string }) => Promise<void>;
  retrying?: boolean | undefined;
};

type MasterRelationBoardProps = {
  gameTitle: GameTitleRelation;
  map: ScopedMasterRelation;
  scopedDisabledReason?: string | undefined;
  selectedGameTitleName?: string | undefined;
  season: ScopedMasterRelation;
};

const mapPanelLabels = {
  title: "マップ",
  itemLabel: "マップ",
  emptyDescription: "この作品に紐づくマップは未登録です。",
};
const seasonPanelLabels = {
  title: "シーズン",
  itemLabel: "シーズン",
  emptyDescription: "この作品に紐づくシーズンは未登録です。",
};

export function MasterRelationBoard({
  gameTitle,
  map,
  scopedDisabledReason,
  selectedGameTitleName,
  season,
}: MasterRelationBoardProps) {
  const mapActions = { onDelete: map.onDelete, onUpdate: map.onUpdate };
  const mapList = {
    error: map.error,
    items: map.items,
    loading: map.loading,
    onRetry: map.onRetry,
    retrying: map.retrying,
  };
  const seasonActions = { onDelete: season.onDelete, onUpdate: season.onUpdate };
  const seasonList = {
    error: season.error,
    items: season.items,
    loading: season.loading,
    onRetry: season.onRetry,
    retrying: season.retrying,
  };

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(16rem,1fr)_minmax(18rem,1fr)_minmax(18rem,1fr)]">
      <GameTitleList
        create={gameTitle.create}
        defaultLayoutFamily={gameTitle.defaultLayoutFamily}
        items={gameTitle.items}
        onDelete={gameTitle.onDelete}
        onUpdate={gameTitle.onUpdate}
        onSelect={gameTitle.onSelect}
        selectedGameTitleId={gameTitle.selectedId}
      />

      <ScopedMasterPanel
        actions={mapActions}
        create={map.create}
        labels={mapPanelLabels}
        list={mapList}
        selectedGameTitleName={selectedGameTitleName}
        disabledReason={scopedDisabledReason}
      />

      <ScopedMasterPanel
        actions={seasonActions}
        create={season.create}
        labels={seasonPanelLabels}
        list={seasonList}
        selectedGameTitleName={selectedGameTitleName}
        disabledReason={scopedDisabledReason}
      />
    </section>
  );
}
