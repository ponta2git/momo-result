import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import {
  formatDateTimeLong,
  toIsoFromLocalDateTime,
  toLocalDateTimeInputValue,
} from "@/shared/lib/dateTime";

export const emptyHeldEvents: HeldEventResponse[] = [];
export const heldEventPageSizeOptions = [10, 25, 50] as const;

export type HeldEventCreateFormModel = {
  action: (formData: FormData) => void | Promise<void>;
  errorMessage: string;
  heldAtDraft: string;
  open: boolean;
  pending: boolean;
  setHeldAtDraft: (value: string) => void;
  setOpen: (open: boolean) => void;
  state: { version: number };
};

export type HeldEventDeleteDialogModel = {
  cancel: () => void;
  confirm: (event: HeldEventResponse) => Promise<void>;
  pending: boolean;
  target: HeldEventResponse | null;
};

export type HeldEventsListActions = {
  deletePending: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRetry: () => void;
  onRequestDelete: (event: HeldEventResponse) => void;
};

export type HeldEventsListModel = {
  loadFailed: boolean;
  loading: boolean;
  page: number;
  pageSize: number;
  pagination: HeldEventListResponse["pagination"] | undefined;
  refreshing: boolean;
  requestedPage: number;
  requestedPageSize: number;
  returnTo: string;
  rows: HeldEventResponse[];
  scopeChanging: boolean;
  stale: boolean;
};

export function currentLocalIsoMinute(): string {
  return toLocalDateTimeInputValue();
}

export function toIsoFromLocal(value: string): string {
  return toIsoFromLocalDateTime(value);
}

export function formatDateTime(value: string): string {
  return formatDateTimeLong(value);
}
