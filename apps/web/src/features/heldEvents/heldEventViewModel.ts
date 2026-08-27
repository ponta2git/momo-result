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

export type HeldEventsListModel =
  | { kind: "loading"; refresh: HeldEventsListRefreshModel }
  | { kind: "loadFailed"; refresh: HeldEventsListRefreshModel }
  | {
      deletePending: boolean;
      freshness: "current" | "stale";
      kind: "ready";
      onPageChange: (page: number) => void;
      onPageSizeChange: (pageSize: number) => void;
      onRequestDelete: (event: HeldEventResponse) => void;
      page: number;
      pageSize: number;
      pagination: HeldEventListResponse["pagination"] | undefined;
      refresh: HeldEventsListRefreshModel;
      requestedPage: number;
      requestedPageSize: number;
      returnTo: string;
      rows: HeldEventResponse[];
      scopeChanging: boolean;
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
