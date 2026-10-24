import type { MatchAchievementSelection } from "@/features/matches/workspace/matchAchievementSelection";
import type {
  MatchFormValues,
  MatchSetupValues,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { SourceImageItem } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import type { HeldEventPickerDirectory } from "@/shared/heldEvents/heldEventPickerTypes";

export type WorkspaceNoticeTone = "info" | "success" | "warning";
export type WorkspaceNotice = { message: string; tone: WorkspaceNoticeTone };

export type MatchWorkspaceMastersNavigationView = {
  pending: boolean;
  show: boolean;
  onNavigate: () => void;
};

export type MatchWorkspaceToolbarView = {
  exit: { href: string; label: string };
  sample: boolean;
};

export type MatchWorkspaceSetupFieldsView = {
  actions: {
    onSelectHeldEvent: (id: string, event: HeldEventResponse | undefined) => void;
    onChangeField: <K extends Exclude<keyof MatchSetupValues, "heldEventId">>(
      field: K,
      value: MatchSetupValues[K],
    ) => void;
  };
  options: {
    gameTitleItems: GameTitleResponse[];
    heldEventPicker: HeldEventPickerDirectory;
    heldEvents: HeldEventResponse[];
    mapItems: MapMasterResponse[];
    seasonItems: SeasonMasterResponse[];
  };
  validation: {
    errorPathSet: ReadonlySet<string>;
    focusRequest?: { path: string; sequence: number } | null;
  };
  values: MatchSetupValues;
};

export type MatchWorkspaceSetupSectionView = {
  eventCreation: {
    action: { pending: boolean; onCreate: () => void };
    feedback: { error: MatchWorkspaceOperationErrorView | null };
    input: { value: string; onChange: (value: string) => void };
  };
  fields: MatchWorkspaceSetupFieldsView;
};

export type MatchWorkspaceCancellationView = {
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

export type MatchWorkspaceRecoveryView = {
  savedAt: string;
  onDiscard: () => void;
  onRestore: () => void;
};

export type MatchWorkspaceSubmitView = {
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

export type MatchWorkspaceConfirmationDialogView = {
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
  values: Pick<MatchFormValues, "matchNoInEvent" | "noteBody" | "players"> & {
    achievements?: readonly MatchAchievementSelection[] | undefined;
    playedAt?: string;
  };
};

export type MatchWorkspaceBlockedReviewView = {
  feedback: { error: MatchWorkspaceOperationErrorView | null };
  refresh: {
    pending: boolean;
    onRefresh: () => Promise<void>;
  };
};

export type MatchWorkspaceEditorLayoutView = {
  mode: WorkspaceMode;
  notice: WorkspaceNotice | null;
  warnings: string[];
  setup: {
    eventCreation: MatchWorkspaceSetupSectionView["eventCreation"];
    options: MatchWorkspaceSetupFieldsView["options"];
  };
  sourceImagePanel: {
    accountId?: string | undefined;
    loading: boolean;
    matchDraftId: string;
    sourceImages: SourceImageItem[] | undefined;
    snapshotChanged: boolean;
  } | null;
};
