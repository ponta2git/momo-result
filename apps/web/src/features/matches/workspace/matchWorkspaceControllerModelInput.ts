import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading } from "@/shared/api/queryErrorState";
import type { HeldEventPickerDirectory } from "@/shared/api/useHeldEventPickerDirectory";

import type { MatchFormReducerState } from "./matchFormReducer";
import type { MatchWorkspaceInitialData, WorkspaceMode } from "./matchFormTypes";
import type { SourceImageItem, SourceImageKind } from "./sourceImages/sourceImageTypes";
import type { useMatchWorkspaceFormHandlers } from "./useMatchWorkspaceFormHandlers";
import type { useMatchWorkspaceHandoffNavigation } from "./useMatchWorkspaceHandoffNavigation";
import type { useMatchWorkspaceLocalState } from "./useMatchWorkspaceLocalState";
import type { useMatchWorkspaceQueries } from "./useMatchWorkspaceQueries";
import type { useMatchWorkspaceReviewSession } from "./useMatchWorkspaceReviewSession";
import type { useMatchWorkspaceReviewState } from "./useMatchWorkspaceReviewState";
import type { useMatchWorkspaceSessionDraft } from "./useMatchWorkspaceSessionDraft";
import type { useMatchWorkspaceSubmitFlow } from "./useMatchWorkspaceSubmitFlow";
import type { useMatchWorkspaceValidation } from "./useMatchWorkspaceValidation";
import type { useMatchWorkspaceViewModel } from "./useMatchWorkspaceViewModel";
import type { useWorkspaceHeldEventCreation } from "./useWorkspaceHeldEventCreation";

type FormModelInput = {
  handlers: ReturnType<typeof useMatchWorkspaceFormHandlers>;
  state: MatchFormReducerState;
  validation: {
    focusRequest: { path: string; sequence: number } | null;
    message: string;
    result: ReturnType<typeof useMatchWorkspaceValidation>;
  };
  workspaceData: MatchWorkspaceInitialData | null;
};

type LoadingModelInput = {
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
    loading: boolean;
  };
};

type NavigationModelInput = {
  exit: {
    href: string;
    label: string;
  };
  guard: Pick<
    ReturnType<typeof useMatchWorkspaceSessionDraft>,
    "dirty" | "navigationAllowedRef"
  > & {
    onDiscard: () => void;
  };
  masters: {
    pending: boolean;
    show: boolean;
    onNavigate: () => void;
  };
};

type PersistenceModelInput = {
  busy: boolean;
  cancellation: {
    allowed: boolean;
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
  recovery: Pick<
    ReturnType<typeof useMatchWorkspaceSessionDraft>,
    "discardRecovery" | "recovery" | "restoreRecovery"
  >;
  onPrimaryAction: () => void;
};

type ReviewModelInput = {
  blocked: boolean;
  state: ReturnType<typeof useMatchWorkspaceReviewState>;
  statusRefresh: {
    pending: boolean;
    onRefresh: () => Promise<void>;
  };
};

type SetupModelInput = {
  eventCreation: {
    draftValue: string;
    pending: boolean;
    onDraftChange: (value: string) => void;
  };
  heldEventPicker: HeldEventPickerDirectory;
};

type SourceImageModelInput = {
  items: SourceImageItem[] | undefined;
  loading: boolean;
  preferredKind: SourceImageKind;
  onPreferredKindChange: (kind: SourceImageKind) => void;
};

/**
 * Controller internals cross this boundary by responsibility, not lifecycle order. Each group owns
 * its state, permitted operations, and operation feedback so adding one concern cannot be wired to
 * an unrelated UI merely because two callbacks share a signature.
 */
export type MatchWorkspaceControllerModelArgs = {
  form: FormModelInput;
  loading: LoadingModelInput;
  navigation: NavigationModelInput;
  persistence: PersistenceModelInput;
  review: ReviewModelInput;
  setup: SetupModelInput;
  sourceImages: SourceImageModelInput;
  workspace: {
    mode: WorkspaceMode;
    useSampleDrafts: boolean;
    view: ReturnType<typeof useMatchWorkspaceViewModel>;
  };
};

type ControllerModelSources = {
  form: {
    handlers: ReturnType<typeof useMatchWorkspaceFormHandlers>;
    local: ReturnType<typeof useMatchWorkspaceLocalState>;
    validation: ReturnType<typeof useMatchWorkspaceValidation>;
  };
  loading: {
    queries: ReturnType<typeof useMatchWorkspaceQueries>;
    workspace: boolean;
  };
  navigation: {
    exitHref: string;
    handoff: ReturnType<typeof useMatchWorkspaceHandoffNavigation>;
    masterReturnTo: string | null | undefined;
  };
  persistence: {
    flow: ReturnType<typeof useMatchWorkspaceSubmitFlow>;
    onPrimaryAction: () => void;
  };
  review: {
    onRefreshStatus: () => Promise<void>;
    session: ReturnType<typeof useMatchWorkspaceReviewSession>;
  };
  setup: {
    eventCreation: ReturnType<typeof useWorkspaceHeldEventCreation>;
  };
  sourceImages: SourceImageItem[] | undefined;
  workspace: {
    mode: WorkspaceMode;
    useSampleDrafts: boolean;
    view: ReturnType<typeof useMatchWorkspaceViewModel>;
  };
};

export function createMatchWorkspaceControllerModelInput(
  sources: ControllerModelSources,
): MatchWorkspaceControllerModelArgs {
  const { handlers, local, validation } = sources.form;
  const { queries } = sources.loading;
  const { reviewState, sessionDraft } = sources.review.session;
  const { mutations } = sources.persistence.flow;

  return {
    form: {
      handlers,
      state: local.state,
      validation: {
        focusRequest: local.validationFocusRequest,
        message: local.validationMessage,
        result: validation,
      },
      workspaceData: local.workspaceData,
    },
    loading: {
      base: {
        errors: queries.derived.baseErrors,
        retrying: queries.derived.retryingBaseQueries,
        onRetry: queries.derived.retryBaseQueries,
      },
      edit: {
        failureKind: queries.derived.editLoadFailureKind,
        loading:
          sources.workspace.mode === "edit" && isInitialQueryLoading(queries.matchDetailQuery),
        retrying: queries.matchDetailQuery.isFetching,
        onRetry: queries.derived.retryEdit,
      },
      workspace: { loading: sources.loading.workspace },
    },
    navigation: {
      exit: {
        href: sources.navigation.exitHref,
        label: sources.workspace.mode === "edit" ? "編集をやめる" : "入力をやめる",
      },
      guard: {
        dirty: sessionDraft.dirty,
        navigationAllowedRef: sessionDraft.navigationAllowedRef,
        onDiscard: sessionDraft.markCommitted,
      },
      masters: {
        pending: sources.navigation.handoff.isPending,
        show:
          (sources.workspace.mode === "review" || sources.workspace.mode === "create") &&
          Boolean(sources.navigation.masterReturnTo),
        onNavigate: sources.navigation.handoff.navigateToMasters,
      },
    },
    persistence: {
      busy: mutations.isMutating,
      cancellation: {
        allowed: sources.workspace.view.canCancelDraft,
        confirmOpen: local.cancelDraftConfirmOpen,
        pending: mutations.cancelDraftMutation.isPending,
        onConfirm: sources.persistence.flow.cancelDraftConfirmed,
        onOpenChange: local.setCancelDraftConfirmOpen,
        onTrigger: () => local.setCancelDraftConfirmOpen(true),
      },
      confirmation: {
        open: local.confirmOpen,
        onClose: () => local.setConfirmOpen(false),
        onConfirm: sources.persistence.flow.confirmAction,
      },
      error: local.operationError,
      recovery: {
        discardRecovery: sessionDraft.discardRecovery,
        recovery: sessionDraft.recovery,
        restoreRecovery: sessionDraft.restoreRecovery,
      },
      onPrimaryAction: sources.persistence.onPrimaryAction,
    },
    review: {
      blocked: queries.derived.isOcrRunningBlocked,
      state: reviewState,
      statusRefresh: {
        pending: queries.derived.refreshingReviewStatus,
        onRefresh: sources.review.onRefreshStatus,
      },
    },
    setup: {
      eventCreation: {
        draftValue: local.eventDraftValue,
        pending: sources.setup.eventCreation.isPending,
        onDraftChange: local.setEventDraftValue,
      },
      heldEventPicker: queries.heldEventPicker,
    },
    sourceImages: {
      items: sources.sourceImages,
      loading: queries.sourceImageQuery.isLoading,
      preferredKind: local.preferredImageKind,
      onPreferredKindChange: local.setPreferredImageKind,
    },
    workspace: sources.workspace,
  };
}
