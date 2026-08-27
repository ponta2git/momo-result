import type { MatchFormReducerState } from "@/features/matches/workspace/matchFormReducer";
import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspaceSessionDraft } from "@/features/matches/workspace/matchWorkspaceSessionDraft";
import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import type { HeldEventPickerDirectory } from "@/shared/api/useHeldEventPickerDirectory";
import type { IncidentKey } from "@/shared/domain/incidents";

export type MatchWorkspaceValidationFocusRequest = {
  path: string;
  sequence: number;
} | null;

export type MatchWorkspaceFormCapability = {
  actions: {
    onCreateEvent: () => void;
    onGameTitleChange: (gameTitleId: string) => void;
    onIncidentChange: (index: number, key: IncidentKey, value: number) => void;
    onPatchRoot: (patch: Partial<MatchFormValues>) => void;
    onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
    onPlayOrderChange: (index: number, playOrder: number) => void;
  };
  focusRequest: MatchWorkspaceValidationFocusRequest;
  state: MatchFormReducerState;
  validation: MatchWorkspaceValidationCapability;
  validationMessage: string;
  workspaceData: MatchWorkspaceInitialData | null;
};

export type MatchWorkspaceValidationCapability = {
  validation: { firstMessage?: string | undefined; success: boolean };
  visibleErrorPathSet: Set<string>;
};

export type MatchWorkspaceDraftSessionCapability = {
  dirty: boolean;
  navigationAllowedRef: { current: boolean };
  recovery: MatchWorkspaceSessionDraft | null;
  discardRecovery: () => void;
  markCommitted: () => void;
  restoreRecovery: () => void;
};

export type MatchWorkspaceBaseLoadingCapability = {
  errors: NormalizedApiError[];
  retrying: boolean;
  onRetry: () => Promise<void>;
};

export type MatchWorkspaceEditLoadingCapability = {
  failureKind: "notFound" | "transient" | null;
  loading: boolean;
  retrying: boolean;
  onRetry: () => void;
};

export type MatchWorkspaceLoadingCapability = {
  base: MatchWorkspaceBaseLoadingCapability;
  edit: MatchWorkspaceEditLoadingCapability;
  workspaceLoading: boolean;
};

export type MatchWorkspaceNavigationCapability = {
  exitHref: string;
  masters: {
    pending: boolean;
    returnAvailable: boolean;
    onNavigate: () => void;
  };
};

export type MatchWorkspacePersistenceCapability = {
  busy: boolean;
  cancellation: {
    confirmOpen: boolean;
    pending: boolean;
    onConfirm: () => void | Promise<void>;
    onOpenChange: (open: boolean) => void;
    onTrigger: () => void;
  };
  confirmation: {
    open: boolean;
    onClose: () => void;
    onConfirm: (formData: FormData) => void | Promise<void>;
  };
  error: MatchWorkspaceOperationError | null;
  onPrimaryAction: () => void;
};

export type MatchWorkspaceReviewRefreshCapability = {
  pending: boolean;
  onRefresh: () => Promise<void>;
};

export type MatchWorkspaceReviewCapability = {
  blocked: boolean;
  state: {
    acknowledgeCell: (cellId: string) => void;
    acknowledgedCellIds: string[];
    activeCellId: string | null;
    changedCount: number;
    focusCell: (row: number, field: ReviewFieldKey) => void;
    items: ReviewItem[];
    unresolvedCount: number;
  };
  statusRefresh: MatchWorkspaceReviewRefreshCapability;
};

export type MatchWorkspaceSetupCapability = {
  eventCreation: {
    draftValue: string;
    pending: boolean;
    onDraftChange: (value: string) => void;
  };
  heldEventPicker: HeldEventPickerDirectory;
};

export type MatchWorkspaceSourceImagesCapability = {
  items: SourceImageItem[] | undefined;
  loading: boolean;
  preferredKind: SourceImageKind;
  onPreferredKindChange: (kind: SourceImageKind) => void;
};

export type MatchWorkspaceViewCapability = {
  canCancelDraft: boolean;
  gameTitleItems: GameTitleResponse[];
  hasSourceImagePanel: boolean;
  heldEvents: HeldEventResponse[];
  mapItems: MapMasterResponse[];
  matchDraftIdForImages: string | undefined;
  pageDescription: string;
  pageTitle: string;
  seasonItems: SeasonMasterResponse[];
  selectedGameTitle: GameTitleResponse | undefined;
  selectedHeldEvent: HeldEventResponse | undefined;
  selectedMap: MapMasterResponse | undefined;
  selectedSeason: SeasonMasterResponse | undefined;
};

/**
 * Pure page-model input. React hooks are intentionally absent: the composition hook supplies only
 * data and user intents, so query/mutation implementation changes do not propagate into the view.
 */
export type MatchWorkspacePageModelInput = {
  draftSession: MatchWorkspaceDraftSessionCapability;
  form: MatchWorkspaceFormCapability;
  loading: MatchWorkspaceLoadingCapability;
  navigation: MatchWorkspaceNavigationCapability;
  persistence: MatchWorkspacePersistenceCapability;
  review: MatchWorkspaceReviewCapability;
  setup: MatchWorkspaceSetupCapability;
  sourceImages: MatchWorkspaceSourceImagesCapability;
  workspace: {
    mode: WorkspaceMode;
    useSampleDrafts: boolean;
    view: MatchWorkspaceViewCapability;
  };
};
