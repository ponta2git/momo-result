import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { createMatchWorkspaceEditingStore } from "@/features/matches/workspace/matchWorkspaceEditingStore";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspacePersistenceInput } from "@/features/matches/workspace/MatchWorkspacePersistence";
import {
  buildMatchWorkspaceView,
  isMatchWorkspaceLoading,
} from "@/features/matches/workspace/matchWorkspaceView";
import { useMatchWorkspaceInitialization } from "@/features/matches/workspace/useMatchWorkspaceInitialization";
import { useMatchWorkspaceReads } from "@/features/matches/workspace/useMatchWorkspaceReads";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import { useWorkspaceNotice } from "@/features/matches/workspace/useWorkspaceNotice";
import { useWorkspaceSnapshot } from "@/features/matches/workspace/useWorkspaceSnapshot";
import { toIsoFromLocalDateTime, toLocalDateTimeInputValue } from "@/shared/lib/dateTime";

export function useMatchWorkspace(input: {
  accountId?: string | undefined;
  canManageMasters: boolean;
  canNavigateToMasters: () => boolean;
  matchDraftId?: string | undefined;
  matchId?: string | undefined;
  matchSessionId?: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId?: string | undefined;
}) {
  const {
    accountId,
    canManageMasters,
    canNavigateToMasters,
    matchDraftId,
    matchId,
    matchSessionId,
    mode,
    preferredHeldEventId,
  } = input;
  const [searchParams] = useSearchParams();
  const { notice, notify, notifyToast } = useWorkspaceNotice();
  const [editingStore] = useState(() => createMatchWorkspaceEditingStore(new Date().toISOString()));
  const selection = useWorkspaceSnapshot(editingStore.resourceSelection);
  const initialData = useWorkspaceSnapshot(editingStore.initialData);
  const initialized = useWorkspaceSnapshot(editingStore.initialized);
  const [heldAtInput, setHeldAtInput] = useState<string>(toLocalDateTimeInputValue);
  const [heldEventCreationError, setHeldEventCreationError] =
    useState<MatchWorkspaceOperationError | null>(null);
  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const workspaceKey = matchSessionId ?? matchDraftId ?? matchId ?? mode;
  const {
    heldEventPicker,
    load,
    resources,
    review: draftReview,
  } = useMatchWorkspaceReads({
    gameTitleId: selection.gameTitleId,
    heldEventId: selection.heldEventId,
    matchDraftId,
    sourceImagesDraftId: selection.matchDraftId,
    matchId,
    mode,
    preferredHeldEventId,
    useSampleDrafts,
  });
  const heldEventCreation = useWorkspaceHeldEventCreation({
    onCreated: (event) => editingStore.actions.selectHeldEvent(event.id, event),
    notify,
    setOperationError: setHeldEventCreationError,
  });
  const readNowIso = useCallback(() => new Date().toISOString(), []);
  const initialization = useMatchWorkspaceInitialization({
    ...resources,
    initialized,
    heldEventId: selection.heldEventId,
    heldEvents: resources.heldEventItems,
    matchDraftId,
    mode,
    onInitialize: editingStore.initialize,
    onSelectHeldEvent: editingStore.actions.selectHeldEvent,
    readNowIso,
    preferredHeldEventId,
    preferredHeldEventPending: load.preferredHeldEventPending,
    reviewDraftIdList: draftReview.draftIdList,
    reviewDraftIds: draftReview.draftIds,
    sourceImages: resources.sourceImageItems,
    useSampleDrafts,
  });
  const view = buildMatchWorkspaceView({
    ...resources,
    matchId,
    mode,
    reviewStatus: draftReview.status,
    sourceImages: initialization.snapshot?.sourceImages,
    useSampleDrafts,
    values: selection,
  });
  const workspaceLoading = isMatchWorkspaceLoading({
    confirmedDraftLoaded: view.confirmedDraftLoaded,
    waitingForData: initialization.status === "waiting-for-data",
    reviewBlocked: draftReview.blocked,
    initializationFailed: load.initializationFailed,
  });
  const persistence: MatchWorkspacePersistenceInput = {
    accountId,
    canManageMasters,
    canNavigateToMasters,
    createEventPending: heldEventCreation.pending,
    draftDetail: resources.draftDetail,
    editing: editingStore,
    enabled: initialization.status === "ready",
    matchId,
    mode,
    notify,
    notifyToast,
    useSampleDrafts,
    view,
    workspaceKey,
    workspaceLoading,
  };
  return {
    editing: editingStore,
    editor: {
      mode,
      notice,
      warnings: initialData?.warnings ?? [],
      setup: {
        eventCreation: {
          action: {
            pending: heldEventCreation.pending,
            onCreate: () =>
              heldEventCreation.create({ heldAt: toIsoFromLocalDateTime(heldAtInput) }),
          },
          feedback: {
            error: heldEventCreationError
              ? toMatchWorkspaceOperationErrorView(heldEventCreationError)
              : null,
          },
          input: { value: heldAtInput, onChange: setHeldAtInput },
        },
        options: {
          gameTitleItems: view.gameTitleItems,
          heldEventPicker,
          heldEvents: view.heldEvents,
          mapItems: view.mapItems,
          seasonItems: view.seasonItems,
        },
      },
      sourceImagePanel:
        view.hasSourceImagePanel && view.matchDraftIdForImages
          ? {
              accountId,
              loading: load.sourceImagesLoading,
              matchDraftId: view.matchDraftIdForImages,
              sourceImages: view.sourceImages,
              snapshotChanged:
                initialization.snapshot?.revision !== resources.draftDetail?.updatedAt,
            }
          : null,
    },
    loading: {
      base: load.base,
      edit: load.edit,
      workspace: {
        blocked: load.initializationFailed,
        copy: {
          loadingLabel: {
            create: "試合作成を準備中",
            edit: "試合編集を読み込み中",
            review: "OCR結果を読み込み中",
          }[mode],
        },
        loading: workspaceLoading,
      },
    },
    toolbar: {
      exit: { href: view.exitHref, label: mode === "edit" ? "編集をやめる" : "入力をやめる" },
      sample: useSampleDrafts,
    },
    persistence,
    review: {
      blocked: draftReview.blocked
        ? { feedback: { error: null }, refresh: draftReview.refresh }
        : null,
    },
  };
}
