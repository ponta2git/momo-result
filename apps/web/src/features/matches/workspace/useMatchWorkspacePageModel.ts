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
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import { useWorkspaceNotice } from "@/features/matches/workspace/useWorkspaceNotice";
import { useWorkspaceReadView } from "@/features/matches/workspace/useWorkspaceReadView";
import { toIsoFromLocalDateTime, toLocalDateTimeInputValue } from "@/shared/lib/dateTime";

export function useMatchWorkspacePageModel(input: {
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
  const [editing] = useState(() => createMatchWorkspaceEditingStore(new Date().toISOString()));
  const selection = useWorkspaceReadView(editing.resourceSelection);
  const initialData = useWorkspaceReadView(editing.initialData);
  const initialized = useWorkspaceReadView(editing.initialized);
  const [eventDraftValue, setEventDraftValue] = useState<string>(toLocalDateTimeInputValue);
  const [eventError, setEventError] = useState<MatchWorkspaceOperationError | null>(null);
  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const workspaceKey = matchSessionId ?? matchDraftId ?? matchId ?? mode;
  const {
    heldEventPicker,
    load,
    resources,
    review: remoteReview,
  } = useMatchWorkspaceQueries({
    gameTitleId: selection.gameTitleId,
    heldEventId: selection.heldEventId,
    matchDraftId,
    matchDraftSourceImagesId: selection.matchDraftId,
    matchId,
    mode,
    preferredHeldEventId,
    useSampleDrafts,
  });
  const createEvent = useWorkspaceHeldEventCreation({
    onCreated: (event) => editing.actions.selectHeldEvent(event.id, event),
    notify,
    setOperationError: setEventError,
  });
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const initialization = useMatchWorkspaceInit({
    ...resources,
    initialized,
    heldEventId: selection.heldEventId,
    heldEvents: resources.heldEventItems,
    matchDraftId,
    mode,
    onInitialize: editing.initialize,
    onSelectHeldEvent: editing.actions.selectHeldEvent,
    nowIsoFactory,
    preferredHeldEventId,
    preferredHeldEventPending: load.preferredHeldEventPending,
    reviewDraftIdList: remoteReview.draftIdList,
    reviewDraftIds: remoteReview.draftIds,
    sourceImages: resources.sourceImageItems,
    useSampleDrafts,
  });
  const view = buildMatchWorkspaceView({
    ...resources,
    matchId,
    mode,
    reviewStatus: remoteReview.status,
    sourceImages: initialization.snapshot?.sourceImages,
    useSampleDrafts,
    values: selection,
  });
  const workspaceLoading = isMatchWorkspaceLoading({
    confirmedDraftLoaded: view.confirmedDraftLoaded,
    waitingForData: initialization.status === "waiting-for-data",
    reviewBlocked: remoteReview.blocked,
    initializationFailed: load.initializationFailed,
  });
  const persistence: MatchWorkspacePersistenceInput = {
    accountId,
    canManageMasters,
    canNavigateToMasters,
    createEventPending: createEvent.pending,
    draftDetail: resources.draftDetail,
    editing,
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
    editing,
    editor: {
      mode,
      notice,
      warnings: initialData?.warnings ?? [],
      setup: {
        eventCreation: {
          action: {
            pending: createEvent.pending,
            onCreate: () => createEvent.create({ heldAt: toIsoFromLocalDateTime(eventDraftValue) }),
          },
          feedback: { error: eventError ? toMatchWorkspaceOperationErrorView(eventError) : null },
          input: { value: eventDraftValue, onChange: setEventDraftValue },
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
      blocked: remoteReview.blocked
        ? { feedback: { error: null }, refresh: remoteReview.refresh }
        : null,
    },
  };
}
