import type {
  CreateHeldEventRequest,
  HeldEventListResponse,
  HeldEventResponse,
} from "@/shared/api/heldEvents";
import { toIsoFromLocalDateTime } from "@/shared/lib/dateTime";
import { parsePositiveIntSearchParam } from "@/shared/lib/searchParams";

export const emptyHeldEvents: HeldEventResponse[] = [];
export const heldEventPageSizeOptions = [10, 25, 50] as const;
const defaultPagination = { page: 1, pageSize: 10 };
const pageSizeOptions = new Set<number>(heldEventPageSizeOptions);

export type HeldEventsPagination = { page: number; pageSize: number };

export function readHeldEventsPagination(params: URLSearchParams): HeldEventsPagination {
  const pageSize = parsePositiveIntSearchParam(params.get("pageSize"), defaultPagination.pageSize);
  return {
    page: parsePositiveIntSearchParam(params.get("page"), defaultPagination.page),
    pageSize: pageSizeOptions.has(pageSize) ? pageSize : defaultPagination.pageSize,
  };
}

export function heldEventsPaginationParams(next: HeldEventsPagination): URLSearchParams {
  const params = new URLSearchParams();
  if (next.page !== defaultPagination.page) params.set("page", String(next.page));
  if (next.pageSize !== defaultPagination.pageSize) params.set("pageSize", String(next.pageSize));
  return params;
}

export function changeHeldEventsPagination(
  current: HeldEventsPagination,
  change: { kind: "page"; page: number } | { kind: "pageSize"; pageSize: number },
): HeldEventsPagination {
  return change.kind === "page"
    ? { ...current, page: change.page }
    : { page: 1, pageSize: change.pageSize };
}

export function heldEventsPageCorrection(
  requested: HeldEventsPagination,
  pagination: HeldEventListResponse["pagination"] | undefined,
  placeholder: boolean,
): number | undefined {
  if (!pagination || placeholder) return undefined;
  const lastPage = Math.max(pagination.totalPages, 1);
  return requested.page > lastPage ? lastPage : undefined;
}

export function createHeldEventRequest(
  heldAt: string,
): { kind: "invalid"; message: string } | { kind: "ready"; request: CreateHeldEventRequest } {
  return heldAt
    ? { kind: "ready", request: { heldAt: toIsoFromLocalDateTime(heldAt) } }
    : { kind: "invalid", message: "開催日時を入力してください。" };
}

export function canDeleteHeldEvent(event: HeldEventResponse): boolean {
  return event.matchCount === 0 && event.draftCount === 0;
}

export type HeldEventCreateFormModel = {
  action: (formData: FormData) => void | Promise<void>;
  canSubmit: boolean;
  errorMessage: string;
  formKey: number;
  heldAtDraft: string;
  open: boolean;
  pending: boolean;
  setHeldAtDraft: (value: string) => void;
  setOpen: (open: boolean) => void;
};

export type HeldEventDeleteDialogModel = {
  cancel: () => void;
  confirm: (event: HeldEventResponse) => Promise<void>;
  pending: boolean;
  target: HeldEventResponse | null;
};

export type HeldEventsListRefreshModel = {
  pending: boolean;
  run: () => void;
};

export type HeldEventsListSnapshot =
  | { kind: "loading" }
  | { kind: "loadFailed" }
  | {
      freshness: "current" | "stale";
      kind: "ready";
      page: number;
      pageSize: number;
      pagination: HeldEventListResponse["pagination"] | undefined;
      rows: HeldEventResponse[];
      scopeChanging: boolean;
    };

export type HeldEventsListActions = {
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRequestDelete: (event: HeldEventResponse) => void;
};

export type HeldEventsListModel =
  | { kind: "loading"; refresh: HeldEventsListRefreshModel }
  | { kind: "loadFailed"; refresh: HeldEventsListRefreshModel }
  | (Extract<HeldEventsListSnapshot, { kind: "ready" }> &
      HeldEventsListActions & {
        deleteDisabled: boolean;
        firstRowIsLatest: boolean;
        refresh: HeldEventsListRefreshModel;
      });

export function buildHeldEventsListSnapshot({
  requested,
  data,
  initialLoading,
  loadFailed,
  stale,
  placeholder,
  fetching,
  correctionPage,
}: {
  requested: HeldEventsPagination;
  data: HeldEventListResponse | undefined;
  initialLoading: boolean;
  loadFailed: boolean;
  stale: boolean;
  placeholder: boolean;
  fetching: boolean;
  correctionPage: number | undefined;
}): HeldEventsListSnapshot {
  if ((initialLoading && !loadFailed) || correctionPage !== undefined) return { kind: "loading" };
  if (loadFailed) return { kind: "loadFailed" };
  return {
    kind: "ready",
    freshness: stale ? "stale" : "current",
    page: data?.pagination?.page ?? requested.page,
    pageSize: data?.pagination?.pageSize ?? requested.pageSize,
    pagination: data?.pagination,
    rows: data?.items ?? emptyHeldEvents,
    scopeChanging: placeholder && fetching,
  };
}

export function buildHeldEventsListModel(
  snapshot: HeldEventsListSnapshot,
  refresh: HeldEventsListRefreshModel,
  actions: HeldEventsListActions,
  deletePending: boolean,
): HeldEventsListModel {
  return snapshot.kind === "ready"
    ? {
        ...snapshot,
        ...actions,
        refresh,
        deleteDisabled: deletePending || snapshot.freshness === "stale" || snapshot.scopeChanging,
        firstRowIsLatest: snapshot.page === 1,
      }
    : { ...snapshot, refresh };
}

export function heldEventsPageControls({
  list,
  create,
  deleteDialog,
  refresh,
  errorMessage,
}: {
  list: HeldEventsListModel;
  create: HeldEventCreateFormModel;
  deleteDialog: HeldEventDeleteDialogModel;
  refresh: HeldEventsListRefreshModel;
  errorMessage: string;
}) {
  const dialogPending = create.pending || deleteDialog.pending;
  return {
    dialogPending,
    refreshDisabled: refresh.pending || dialogPending,
    refreshPending:
      refresh.pending && !dialogPending && list.kind === "ready" && list.freshness === "current",
    showCreate: list.kind === "ready" && list.rows.length > 0,
    errorMessage: !create.open && !deleteDialog.target ? errorMessage : "",
  };
}
