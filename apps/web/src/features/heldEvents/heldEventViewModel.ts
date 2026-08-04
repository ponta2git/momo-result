import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";

export const emptyHeldEvents: HeldEventResponse[] = [];
export const heldEventPageSizeOptions = [10, 25, 50] as const;

export type HeldEventCreateFormModel = {
  action: (formData: FormData) => void | Promise<void>;
  errorMessage: string;
  heldAtDraft: string;
  open: boolean;
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
  onRequestDelete: (event: HeldEventResponse) => void;
};

export type HeldEventsListModel = {
  loadFailed: boolean;
  loading: boolean;
  page: number;
  pagination: HeldEventListResponse["pagination"] | undefined;
  refreshing: boolean;
  rows: HeldEventResponse[];
};

export function currentLocalIsoMinute(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function toIsoFromLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
