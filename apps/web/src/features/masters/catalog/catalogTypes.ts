import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import type { LayoutFamily } from "@/shared/domain/ocr";

export type OptimisticGameTitle = Readonly<GameTitleResponse & { pending?: boolean }>;
export type OptimisticMapMaster = Readonly<MapMasterResponse & { pending?: boolean }>;
export type OptimisticSeasonMaster = Readonly<SeasonMasterResponse & { pending?: boolean }>;

export type MasterCatalogSelectionInput = {
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
};

export type MasterCreateFormView = Readonly<{
  action: (formData: FormData) => void | Promise<void>;
  error?: string | undefined;
  formKey?: string | number | undefined;
  pending?: boolean | undefined;
}>;

/** The title directory's initial failure and refresh result also control its enclosing tab. */
export type GameTitleCatalogView = Readonly<{
  canEdit: boolean;
  completion?: string | undefined;
  create: MasterCreateFormView;
  defaultLayoutFamily: LayoutFamily;
  hasData: boolean;
  items: readonly OptimisticGameTitle[];
  loadFailed: boolean;
  onRetry: () => Promise<boolean>;
  onDelete: (id: string) => Promise<void> | void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, request: { name: string; layoutFamily: string }) => Promise<void>;
  selectedGameTitleId: string;
  refreshing: boolean;
  stale: boolean;
}>;

export type ScopedMasterCatalogView = Readonly<{
  actions: Readonly<{
    onDelete: (id: string) => Promise<void> | void;
    onUpdate: (id: string, request: { name: string }) => Promise<void>;
  }>;
  create: Readonly<MasterCreateFormView & { scopeKey: string }>;
  list: Readonly<{
    completion?: string | undefined;
    error?: string | undefined;
    hasData: boolean;
    items: ReadonlyArray<OptimisticMapMaster | OptimisticSeasonMaster>;
    loadFailed: boolean;
    loading?: boolean | undefined;
    onRetry: () => void;
    retrying?: boolean | undefined;
    stale: boolean;
  }>;
}>;

export type MasterCatalogView = Readonly<{
  gameTitle: GameTitleCatalogView;
  map: ScopedMasterCatalogView;
  scopedDisabledReason?: string | undefined;
  season: ScopedMasterCatalogView;
}>;
