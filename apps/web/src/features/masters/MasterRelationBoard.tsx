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
  pending?: boolean | undefined;
};

type GameTitleRelation = {
  create: MasterCreateBinding;
  defaultLayoutFamily: LayoutFamily;
  items: GameTitleListItem[];
  onRetry: () => void;
  onDelete: (id: string) => Promise<void> | void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, request: { name: string; layoutFamily: string }) => Promise<void>;
  selectedId: string;
  refreshing: boolean;
  stale: boolean;
};

type ScopedMasterRelation = {
  create: MasterCreateBinding;
  error?: string | undefined;
  hasData: boolean;
  items: ScopedMasterListItem[];
  loadFailed: boolean;
  loading?: boolean | undefined;
  onRetry: () => void;
  onDelete: (id: string) => Promise<void> | void;
  onUpdate: (id: string, request: { name: string }) => Promise<void>;
  retrying?: boolean | undefined;
  stale: boolean;
};

type MasterRelationBoardProps = {
  gameTitle: GameTitleRelation;
  map: ScopedMasterRelation;
  scopedDisabledReason?: string | undefined;
  season: ScopedMasterRelation;
};

const mapPanelLabels = {
  title: "マップ",
  itemLabel: "マップ",
};
const seasonPanelLabels = {
  title: "シーズン",
  itemLabel: "シーズン",
};

export function MasterRelationBoard({
  gameTitle,
  map,
  scopedDisabledReason,
  season,
}: MasterRelationBoardProps) {
  const mapActions = { onDelete: map.onDelete, onUpdate: map.onUpdate };
  const mapList = {
    error: map.error,
    hasData: map.hasData,
    items: map.items,
    loadFailed: map.loadFailed,
    loading: map.loading,
    onRetry: map.onRetry,
    retrying: map.retrying,
    stale: map.stale,
  };
  const seasonActions = { onDelete: season.onDelete, onUpdate: season.onUpdate };
  const seasonList = {
    error: season.error,
    hasData: season.hasData,
    items: season.items,
    loadFailed: season.loadFailed,
    loading: season.loading,
    onRetry: season.onRetry,
    retrying: season.retrying,
    stale: season.stale,
  };

  return (
    <section className="grid gap-8">
      <GameTitleList
        create={gameTitle.create}
        defaultLayoutFamily={gameTitle.defaultLayoutFamily}
        items={gameTitle.items}
        onDelete={gameTitle.onDelete}
        onRetry={gameTitle.onRetry}
        onUpdate={gameTitle.onUpdate}
        onSelect={gameTitle.onSelect}
        selectedGameTitleId={gameTitle.selectedId}
        refreshing={gameTitle.refreshing}
        stale={gameTitle.stale}
      />

      <div>
        <div className="grid min-w-0 gap-6 xl:grid-cols-2 xl:gap-0">
          <div className="min-w-0 xl:pr-6">
            <ScopedMasterPanel
              actions={mapActions}
              create={map.create}
              labels={mapPanelLabels}
              list={mapList}
              disabledReason={scopedDisabledReason}
            />
          </div>

          <div className="min-w-0 border-t border-[var(--color-border)] pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
            <ScopedMasterPanel
              actions={seasonActions}
              create={season.create}
              labels={seasonPanelLabels}
              list={seasonList}
              disabledReason={scopedDisabledReason}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
