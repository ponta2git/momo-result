import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  currentLocalIsoMinute,
  emptyHeldEvents,
  heldEventPageSizeOptions,
  toIsoFromLocal,
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

export function useHeldEventsPageController() {
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
      showToast({ title: "開催履歴を作成しました。", tone: "success" });
      navigate(withReturnTo(`/held-events/${encodeURIComponent(event.id)}`, listReturnTo));
      return { version: previous.version + 1 };
    } catch (error) {
      setErrorMessage(formatApiError(error, "開催履歴の作成に失敗しました"));
      return previous;
    }
  }, initialCreateHeldEventState);

  const deleteMutation = useMutation({
    mutationFn: (event: HeldEventResponse) => deleteHeldEvent(event.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
      setDeleteTarget(null);
      setErrorMessage("");
      showToast({ title: "開催履歴を削除しました。", tone: "success" });
    },
  });

  const rows = heldEventsQuery.data?.items ?? emptyHeldEvents;
  const pagination = heldEventsQuery.data?.pagination;
  const scopeChanging = Boolean(heldEventsQuery.isPlaceholderData && heldEventsQuery.isFetching);
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
  };
  const updateCreateOpen = useCallback((open: boolean) => {
    setCreateOpen(open);
    if (open) {
      setErrorMessage("");
    }
  }, []);
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
  const confirmDelete = async (event: HeldEventResponse) => {
    await deleteMutation.mutateAsync(event);
  };

  return {
    create: {
      action: createAction,
      errorMessage,
      heldAtDraft,
      open: createOpen,
      pending: createPending,
      setHeldAtDraft,
      setOpen: updateCreateOpen,
      state: createState,
    },
    deleteDialog: {
      cancel: cancelDelete,
      confirm: confirmDelete,
      pending: deleteMutation.isPending,
      target: deleteTarget,
    },
    feedback: {
      errorMessage,
      refreshFailed: shouldShowQueryError(heldEventsQuery) && hasCurrentScopeData,
    },
    header: {
      openCreate: () => updateCreateOpen(true),
      refresh,
      refreshing: heldEventsQuery.isFetching,
    },
    table: {
      actions: {
        deletePending: deleteMutation.isPending,
        onPageChange: updatePage,
        onPageSizeChange: updatePageSize,
        onRetry: refresh,
        onRequestDelete: setDeleteTarget,
      },
      data: {
        loadFailed:
          shouldShowBlockingQueryError(heldEventsQuery) ||
          (shouldShowQueryError(heldEventsQuery) && !hasCurrentScopeData),
        loading: isInitialQueryLoading(heldEventsQuery) || pageCorrectionPending,
        page: displayedPage,
        pageSize: displayedPageSize,
        pagination,
        refreshing: heldEventsQuery.isFetching,
        requestedPage: paginationSearch.page,
        requestedPageSize: paginationSearch.pageSize,
        returnTo: displayedReturnTo,
        rows,
        scopeChanging,
        stale: shouldShowQueryError(heldEventsQuery) && hasCurrentScopeData,
      },
    },
  };
}
