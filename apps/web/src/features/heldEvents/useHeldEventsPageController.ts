import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState, useMemo, useState } from "react";

import {
  currentLocalIsoMinute,
  emptyHeldEvents,
  formatDateTime,
  toIsoFromLocal,
} from "@/features/heldEvents/heldEventViewModel";
import { syncHeldEventCreatedCache, syncHeldEventDeletedCache } from "@/shared/api/heldEventCache";
import { createHeldEvent, deleteHeldEvent, listHeldEvents } from "@/shared/api/heldEvents";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateHeldEventState = { version: 0 };

export function useHeldEventsPageController() {
  const queryClient = useQueryClient();
  const [heldAtDraft, setHeldAtDraft] = useState(currentLocalIsoMinute);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HeldEventResponse | null>(null);
  const idempotencyKeys = useIdempotencyKeyStore();

  const heldEventsQuery = useQuery({
    queryFn: () => listHeldEvents("", 100),
    queryKey: heldEventKeys.scope("held-events-page"),
  });

  const [createState, createAction] = useActionState<typeof initialCreateHeldEventState, FormData>(
    async (previous, formData) => {
      const heldAt = String(formData.get("heldAt") ?? "");
      if (!heldAt) {
        setNotice("");
        setErrorMessage("開催日時を入力してください。");
        return previous;
      }

      try {
        const request = { heldAt: toIsoFromLocal(heldAt) };
        const event = await runIdempotentMutation(
          idempotencyKeys,
          "heldEvents.createHeldEvent",
          request,
          (options) => createHeldEvent(request, options),
        );
        await syncHeldEventCreatedCache(queryClient, "held-events-page", event);
        setHeldAtDraft(currentLocalIsoMinute());
        setErrorMessage("");
        setNotice(`開催履歴（${formatDateTime(event.heldAt)}）を作成しました。`);
        showToast({ title: "開催履歴を作成しました。", tone: "success" });
        return { version: previous.version + 1 };
      } catch (error) {
        setNotice("");
        setErrorMessage(formatApiError(error, "開催履歴の作成に失敗しました"));
        return previous;
      }
    },
    initialCreateHeldEventState,
  );

  const deleteMutation = useMutation({
    mutationFn: (event: HeldEventResponse) => deleteHeldEvent(event.id),
    onSuccess: async (response) => {
      await syncHeldEventDeletedCache(queryClient, "held-events-page", response.heldEventId);
      setDeleteTarget(null);
      setErrorMessage("");
      setNotice("開催履歴を削除しました。");
      showToast({ title: "開催履歴を削除しました。", tone: "success" });
    },
    onError: (error) => {
      setNotice("");
      setErrorMessage(formatApiError(error, "開催履歴の削除に失敗しました"));
    },
  });

  const rows = heldEventsQuery.data?.items ?? emptyHeldEvents;
  const totalMatches = useMemo(
    () => rows.reduce((sum, event) => sum + event.matchCount, 0),
    [rows],
  );
  const refresh = () => {
    void heldEventsQuery.refetch();
  };

  return {
    createAction,
    createState,
    deleteMutation,
    deleteTarget,
    errorMessage,
    heldAtDraft,
    latestEvent: rows[0],
    liveMessage: notice || errorMessage,
    loadFailed: shouldShowBlockingQueryError(heldEventsQuery),
    loading: isInitialQueryLoading(heldEventsQuery),
    refreshing: heldEventsQuery.isFetching,
    refresh,
    rows,
    setDeleteTarget,
    setHeldAtDraft,
    totalMatches,
  };
}
