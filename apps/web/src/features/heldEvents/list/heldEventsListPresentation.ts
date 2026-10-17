import type {
  HeldEventCreateForm,
  HeldEventDeleteConfirmation,
} from "@/features/heldEvents/list/heldEventActions";
import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { parsePositiveIntSearchParam } from "@/shared/lib/searchParams";

export type HeldEventListItem = Readonly<Omit<HeldEventResponse, "scopes">> & {
  readonly scopes?: ReadonlyArray<Readonly<NonNullable<HeldEventResponse["scopes"]>[number]>>;
};

export const emptyHeldEvents: readonly HeldEventListItem[] = [];
export const heldEventPageSizeOptions = [10, 25, 50] as const;
const defaultPagination = { page: 1, pageSize: 10 };
const pageSizeOptions = new Set<number>(heldEventPageSizeOptions);

export type HeldEventsPagination = { readonly page: number; readonly pageSize: number };

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

export type HeldEventsListRefresh = {
  readonly pending: boolean;
  readonly run: () => void;
};

export type HeldEventsListSnapshot =
  | { readonly kind: "loading" }
  | { readonly kind: "loadFailed" }
  | {
      readonly freshness: "current" | "stale";
      readonly kind: "ready";
      readonly page: number;
      readonly pageSize: number;
      readonly pagination: Readonly<HeldEventListResponse["pagination"]> | undefined;
      readonly rows: readonly HeldEventListItem[];
      readonly scopeChanging: boolean;
    };

export type HeldEventsListActions = {
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly onRequestDelete: (event: Readonly<Pick<HeldEventResponse, "id" | "heldAt">>) => void;
};

export type HeldEventsListView =
  | { readonly kind: "loading"; readonly refresh: HeldEventsListRefresh }
  | { readonly kind: "loadFailed"; readonly refresh: HeldEventsListRefresh }
  | (Extract<HeldEventsListSnapshot, { kind: "ready" }> &
      HeldEventsListActions & {
        readonly deleteDisabled: boolean;
        readonly firstRowIsLatest: boolean;
        readonly refresh: HeldEventsListRefresh;
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
  } as const;
}

export function buildHeldEventsListView(
  snapshot: HeldEventsListSnapshot,
  refresh: HeldEventsListRefresh,
  actions: HeldEventsListActions,
  deletePending: boolean,
): HeldEventsListView {
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

export function buildHeldEventsActionView({
  list,
  create,
  deleteDialog,
  refresh,
  errorMessage,
}: {
  list: HeldEventsListView;
  create: HeldEventCreateForm;
  deleteDialog: HeldEventDeleteConfirmation;
  refresh: HeldEventsListRefresh;
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
  } as const;
}
