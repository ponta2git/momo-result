import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";

export const emptyHeldEvents: HeldEventResponse[] = [];
export const heldEventPageSizeOptions = [10, 25, 50] as const;

export type HeldEventCreateFormModel = {
  action: (formData: FormData) => void | Promise<void>;
  heldAtDraft: string;
  setHeldAtDraft: (value: string) => void;
  state: { version: number };
};

export type HeldEventDeleteDialogModel = {
  cancel: () => void;
  confirm: (event: HeldEventResponse) => Promise<void>;
  pending: boolean;
  target: HeldEventResponse | null;
};

export type HeldEventsTableActions = {
  deletePending: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRequestDelete: (event: HeldEventResponse) => void;
};

export type HeldEventsTableModel = {
  loadFailed: boolean;
  loading: boolean;
  pagination: HeldEventListResponse["pagination"] | undefined;
  refreshing: boolean;
  rows: HeldEventResponse[];
  totalMatches: number;
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

export function formatDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
