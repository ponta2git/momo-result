import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  currentLocalIsoMinute,
  emptyHeldEvents,
  formatDateTime,
  toIsoFromLocal,
} from "@/features/heldEvents/heldEventViewModel";
import { createHeldEvent, deleteHeldEvent, listHeldEvents } from "@/shared/api/heldEvents";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateHeldEventState = { version: 0 };
const defaultPagination = { page: 1, pageSize: 25 };
const pageSizeOptions = new Set([25, 50, 100]);

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function useHeldEventsPageController() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const paginationSearch = useMemo(() => {
    const pageSize = Number(searchParams.get("pageSize"));
    return {
      page: parsePositiveInt(searchParams.get("page"), defaultPagination.page),
      pageSize: pageSizeOptions.has(pageSize) ? pageSize : defaultPagination.pageSize,
    };
  }, [searchParams]);
  const [heldAtDraft, setHeldAtDraft] = useState(currentLocalIsoMinute);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HeldEventResponse | null>(null);
  const idempotencyKeys = useIdempotencyKeyStore();

  const updatePagination = useCallback(
    (next: { page: number; pageSize: number }) => {
      const params = new URLSearchParams(searchParams);
      if (next.page === defaultPagination.page) {
        params.delete("page");
      } else {
        params.set("page", String(next.page));
      }
      if (next.pageSize === defaultPagination.pageSize) {
        params.delete("pageSize");
      } else {
        params.set("pageSize", String(next.pageSize));
      }
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const heldEventsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listHeldEvents({ page: paginationSearch.page, pageSize: paginationSearch.pageSize }, 10, {
        signal,
      }),
    queryKey: heldEventKeys.list(paginationSearch),
  });
  const latestHeldEventQuery = useQuery({
    queryFn: ({ signal }) => listHeldEvents({ page: 1, pageSize: 1 }, 10, { signal }),
    queryKey: heldEventKeys.list({ page: 1, pageSize: 1, scope: "latest" }),
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
        updatePagination({ page: 1, pageSize: paginationSearch.pageSize });
        await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
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
  const pagination = heldEventsQuery.data?.pagination;
  const totalMatches = heldEventsQuery.data?.totalMatchCount ?? 0;
  const pageCorrectionPending = Boolean(
    pagination &&
    !heldEventsQuery.isPlaceholderData &&
    paginationSearch.page > Math.max(pagination.totalPages, 1),
  );

  useEffect(() => {
    if (!pagination || heldEventsQuery.isPlaceholderData) {
      return;
    }
    const lastPage = Math.max(pagination.totalPages, 1);
    if (paginationSearch.page > lastPage) {
      updatePagination({ page: lastPage, pageSize: paginationSearch.pageSize });
    }
  }, [heldEventsQuery.isPlaceholderData, pagination, paginationSearch, updatePagination]);

  const refresh = () => {
    void heldEventsQuery.refetch();
    void latestHeldEventQuery.refetch();
  };

  return {
    createAction,
    createState,
    deleteMutation,
    deleteTarget,
    errorMessage,
    heldAtDraft,
    latestEvent: latestHeldEventQuery.data?.items?.[0],
    liveMessage: notice || errorMessage,
    loadFailed: shouldShowBlockingQueryError(heldEventsQuery),
    loading: isInitialQueryLoading(heldEventsQuery) || pageCorrectionPending,
    pagination,
    refreshing: heldEventsQuery.isFetching,
    refresh,
    rows,
    setDeleteTarget,
    setHeldAtDraft,
    totalMatches,
    updatePage: (page: number) => {
      updatePagination({ page, pageSize: paginationSearch.pageSize });
    },
    updatePageSize: (pageSize: number) => {
      updatePagination({ page: 1, pageSize });
    },
  };
}
