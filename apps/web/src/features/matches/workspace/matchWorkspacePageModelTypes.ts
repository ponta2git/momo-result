import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type {
  ScoreGridActions,
  ScoreGridData,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
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

export type MatchWorkspaceMastersNavigationModel = {
  pending: boolean;
  show: boolean;
  onNavigate: () => void;
};

export type MatchWorkspaceNavigationGuardModel = {
  dirty: boolean;
  navigationAllowedRef: { current: boolean };
  onDiscard: () => void;
};

export type MatchWorkspaceToolbarModel = {
  exit: { href: string; label: string };
  sample: boolean;
};

type MatchWorkspaceLoadingModel = {
  base: {
    errors: NormalizedApiError[];
    retrying: boolean;
    onRetry: () => Promise<void>;
  };
  edit: {
    failureKind: "notFound" | "transient" | null;
    loading: boolean;
    retrying: boolean;
    onRetry: () => void;
  };
  workspace: {
    blocked: boolean;
    copy: { loadingLabel: string };
    loading: boolean;
  };
};

export type MatchWorkspaceSetupFieldsModel = {
  actions: {
    onGameTitleChange: (gameTitleId: string) => void;
    onPatchRoot: (patch: Partial<MatchFormValues>) => void;
  };
  options: {
    gameTitleItems: GameTitleResponse[];
    heldEventPicker: HeldEventPickerDirectory;
    heldEvents: HeldEventResponse[];
    mapItems: MapMasterResponse[];
    seasonItems: SeasonMasterResponse[];
  };
  validation: { errorPathSet: Set<string> };
  values: MatchFormValues;
};

export type MatchWorkspaceSetupSectionModel = {
  eventCreation: {
    action: { pending: boolean; onCreate: () => void };
    feedback: { error: MatchWorkspaceOperationErrorView | null };
    input: { value: string; onChange: (value: string) => void };
  };
  fields: MatchWorkspaceSetupFieldsModel;
};

export type MatchWorkspaceCancellationModel = {
  allowed: boolean;
  dialog: {
    open: boolean;
    pending: boolean;
    onConfirm: () => void | Promise<void>;
    onOpenChange: (open: boolean) => void;
  };
  disabled: boolean;
  error: MatchWorkspaceOperationErrorView | null;
  onTrigger: () => void;
};

export type MatchWorkspaceRecoveryModel = {
  savedAt: string;
  onDiscard: () => void;
  onRestore: () => void;
};

export type MatchWorkspaceSubmitModel = {
  action: {
    label: "保存" | "確定前の確認へ進む";
    onRun: () => void;
  };
  availability: { disabled: boolean; pending: boolean };
  feedback: {
    error: MatchWorkspaceOperationErrorView | null;
    message: string;
  };
};

export type MatchWorkspaceEditorModel = {
  note: {
    error: boolean;
    onChange: (value: string) => void;
    value: string;
  } | null;
  navigation: { masters: MatchWorkspaceMastersNavigationModel };
  persistence: {
    cancellation: MatchWorkspaceCancellationModel;
    recovery: MatchWorkspaceRecoveryModel | null;
    submit: MatchWorkspaceSubmitModel;
  };
  scoreGrid: {
    actions: Omit<ScoreGridActions, "onRequestSubmitFocus">;
    data: ScoreGridData;
  };
  setup: MatchWorkspaceSetupSectionModel;
  sourceImagePanel: {
    loading: boolean;
    matchDraftId: string;
    preferredKind: SourceImageKind;
    sourceImages: SourceImageItem[] | undefined;
  } | null;
  warnings: string[];
};

export type MatchWorkspaceConfirmationDialogModel = {
  actions: {
    onClose: () => void;
    onConfirm: (formData: FormData) => void | Promise<void>;
  };
  feedback: { validationMessage: string };
  pending: boolean;
  review: { changedCount: number; totalCount: number; unresolvedCount: number };
  summary: {
    gameTitleName: string | undefined;
    heldEvent: HeldEventResponse | undefined;
    mapName: string | undefined;
    seasonName: string | undefined;
  };
  values: MatchFormValues;
};

export type MatchWorkspaceBlockedReviewModel = {
  feedback: { error: MatchWorkspaceOperationErrorView | null };
  refresh: {
    pending: boolean;
    onRefresh: () => Promise<void>;
  };
};

export type MatchWorkspacePageModel = {
  editor: MatchWorkspaceEditorModel;
  loading: MatchWorkspaceLoadingModel;
  navigation: {
    guard: MatchWorkspaceNavigationGuardModel;
    toolbar: MatchWorkspaceToolbarModel;
  };
  persistence: { confirmation: MatchWorkspaceConfirmationDialogModel | null };
  review: { blocked: MatchWorkspaceBlockedReviewModel | null };
  validationFocusRequest: { path: string; sequence: number } | null;
};
