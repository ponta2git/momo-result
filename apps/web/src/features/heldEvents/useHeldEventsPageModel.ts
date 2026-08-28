import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  currentLocalIsoMinute,
  emptyHeldEvents,
  heldEventPageSizeOptions,
  toIsoFromLocal,
} from "@/features/heldEvents/heldEventViewModel";
import type {
  HeldEventCreateFormModel,
  HeldEventDeleteDialogModel,
  HeldEventsListModel,
  HeldEventsListRefreshModel,
} from "@/features/heldEvents/heldEventViewModel";
import { createHeldEvent, deleteHeldEvent } from "@/shared/api/heldEvents";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { heldEventsQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { parsePositiveIntSearchParam } from "@/shared/lib/searchParams";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateHeldEventState = { version: 0 };
const defaultPagination = { page: 1, pageSize: 10 };
const pageSizeOptions = new Set<number>(heldEventPageSizeOptions);

export type HeldEventsPageModel = {
  create: HeldEventCreateFormModel;
  deleteDialog: HeldEventDeleteDialogModel;
  feedback: { errorMessage: string };
  list: HeldEventsListModel;
  openCreate: () => void;
  refresh: HeldEventsListRefreshModel;
};

function withPaginationParams(
  current: URLSearchParams,
  next: { page: number; pageSize: number },
): URLSearchParams {
  const params = new URLSearchParams(current);
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
  return params;
}

function heldEventsReturnTo(params: URLSearchParams): string {
  const search = params.toString();
  return `/held-events${search ? `?${search}` : ""}`;
}

/** Owns the complete held-event list screen without exposing query or mutation result objects. */
export function useHeldEventsPageModel(): HeldEventsPageModel {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSearch = searchParams.toString();
  const listReturnTo = `/held-events${rawSearch ? `?${rawSearch}` : ""}`;
  const paginationSearch = useMemo(() => {
    const pageSize = parsePositiveIntSearchParam(
      searchParams.get("pageSize"),
      defaultPagination.pageSize,
    );
    return {
      page: parsePositiveIntSearchParam(searchParams.get("page"), defaultPagination.page),
      pageSize: pageSizeOptions.has(pageSize) ? pageSize : defaultPagination.pageSize,
    };
  }, [searchParams]);
  const [heldAtDraft, setHeldAtDraft] = useState(currentLocalIsoMinute);
  const [errorMessage, setErrorMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HeldEventResponse | null>(null);
  const idempotencyKeys = useIdempotencyKeyStore();

  const updatePagination = useCallback(
    (next: { page: number; pageSize: number }) => {
      setSearchParams(withPaginationParams(searchParams, next));
    },
    [searchParams, setSearchParams],
  );

  const heldEventsOptions = heldEventsQueryOptions(paginationSearch);
  const heldEventsQuery = useQuery(heldEventsOptions);
  const hasCurrentScopeData = queryClient.getQueryData(heldEventsOptions.queryKey) !== undefined;
  const {
    data: heldEventsData,
    isFetching: heldEventsIsFetching,
    isPlaceholderData,
    refetch: refetchHeldEvents,
  } = heldEventsQuery;

  const [createState, createAction, createPending] = useActionState<
    typeof initialCreateHeldEventState,
    FormData
  >(async (previous, formData) => {
    const heldAt = String(formData.get("heldAt") ?? "");
    if (!heldAt) {
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
      queryClient.setQueryData(heldEventKeys.detail(event.id), {
        ...event,
        drafts: [],
        matches: [],
      });
      setHeldAtDraft(currentLocalIsoMinute());
      setErrorMessage("");
      setCreateOpen(false);
      showToast({ title: "開催を作成しました。", tone: "success" });
      navigate(withReturnTo(`/held-events/${encodeURIComponent(event.id)}`, listReturnTo));
      return { version: previous.version + 1 };
    } catch (error) {
      setErrorMessage(formatApiError(error, "開催の作成に失敗しました"));
      return previous;
    }
  }, initialCreateHeldEventState);

  const deleteMutation = useMutation({
    mutationFn: (event: HeldEventResponse) => deleteHeldEvent(event.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
      setDeleteTarget(null);
      setErrorMessage("");
      showToast({ title: "開催を削除しました。", tone: "success" });
    },
  });
  const { isPending: deletePending, mutateAsync: deleteEventAsync } = deleteMutation;

  const rows = heldEventsData?.items ?? emptyHeldEvents;
  const pagination = heldEventsData?.pagination;
  const scopeChanging = Boolean(isPlaceholderData && heldEventsIsFetching);
  const displayedPage = pagination?.page ?? paginationSearch.page;
  const displayedPageSize = pagination?.pageSize ?? paginationSearch.pageSize;
  const displayedReturnTo = scopeChanging
    ? heldEventsReturnTo(
        withPaginationParams(searchParams, {
          page: displayedPage,
          pageSize: displayedPageSize,
        }),
      )
    : listReturnTo;
  const pageCorrectionPending = Boolean(
    pagination && !isPlaceholderData && paginationSearch.page > Math.max(pagination.totalPages, 1),
  );

  useEffect(() => {
    if (!pagination || isPlaceholderData) {
      return;
    }
    const lastPage = Math.max(pagination.totalPages, 1);
    if (paginationSearch.page > lastPage) {
      updatePagination({ page: lastPage, pageSize: paginationSearch.pageSize });
    }
  }, [isPlaceholderData, pagination, paginationSearch, updatePagination]);

  const refreshList = useCallback(() => {
    void refetchHeldEvents();
  }, [refetchHeldEvents]);
  const refresh = { pending: heldEventsIsFetching, run: refreshList };
  const updateCreateOpen = useCallback((open: boolean) => {
    setCreateOpen(open);
    if (open) {
      setErrorMessage("");
    }
  }, []);
  const openCreate = useCallback(() => updateCreateOpen(true), [updateCreateOpen]);
  const updatePage = useCallback(
    (page: number) => {
      updatePagination({ page, pageSize: paginationSearch.pageSize });
    },
    [paginationSearch.pageSize, updatePagination],
  );
  const updatePageSize = useCallback(
    (pageSize: number) => {
      updatePagination({ page: 1, pageSize });
    },
    [updatePagination],
  );
  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);
  const confirmDelete = useCallback(
    async (event: HeldEventResponse) => {
      await deleteEventAsync(event);
    },
    [deleteEventAsync],
  );

  const loadFailed =
    shouldShowBlockingQueryError(heldEventsQuery) ||
    (shouldShowQueryError(heldEventsQuery) && !hasCurrentScopeData);
  let list: HeldEventsListModel;
  if (isInitialQueryLoading(heldEventsQuery) || pageCorrectionPending) {
    list = { kind: "loading", refresh };
  } else if (loadFailed) {
    list = { kind: "loadFailed", refresh };
  } else {
    list = {
      deletePending,
      freshness: shouldShowQueryError(heldEventsQuery) && hasCurrentScopeData ? "stale" : "current",
      kind: "ready",
      onPageChange: updatePage,
      onPageSizeChange: updatePageSize,
      onRequestDelete: setDeleteTarget,
      page: displayedPage,
      pageSize: displayedPageSize,
      pagination,
      refresh,
      returnTo: displayedReturnTo,
      rows,
      scopeChanging,
    };
  }

  return {
    create: {
      action: createAction,
      errorMessage,
      formKey: createState.version,
      heldAtDraft,
      open: createOpen,
      pending: createPending,
      setHeldAtDraft,
      setOpen: updateCreateOpen,
    },
    deleteDialog: {
      cancel: cancelDelete,
      confirm: confirmDelete,
      pending: deletePending,
      target: deleteTarget,
    },
    feedback: { errorMessage },
    list,
    openCreate,
    refresh,
  };
}
