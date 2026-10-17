import type { CreateHeldEventRequest, HeldEventResponse } from "@/shared/api/heldEvents";
import { toIsoFromLocalDateTime } from "@/shared/lib/dateTime";

export function createHeldEventRequest(
  heldAt: string,
): { kind: "invalid"; message: string } | { kind: "ready"; request: CreateHeldEventRequest } {
  return heldAt
    ? { kind: "ready", request: { heldAt: toIsoFromLocalDateTime(heldAt) } }
    : { kind: "invalid", message: "開催日時を入力してください。" };
}

export function canDeleteHeldEvent(
  event: Readonly<Pick<HeldEventResponse, "matchCount" | "draftCount">>,
): boolean {
  return event.matchCount === 0 && event.draftCount === 0;
}

export type HeldEventCreateForm = {
  readonly action: (formData: FormData) => void | Promise<void>;
  readonly errorMessage: string;
  readonly formKey: number;
  readonly open: boolean;
  readonly pending: boolean;
  readonly close: () => void;
};

export type HeldEventDeleteConfirmation = {
  readonly cancel: () => void;
  readonly confirm: () => Promise<void>;
  readonly pending: boolean;
  readonly target: { readonly heldAt: string } | null;
};
