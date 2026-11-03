import type { CreateHeldEventRequest } from "@/shared/api/heldEvents";
import { toIsoFromLocalDateTime } from "@/shared/lib/dateTime";

export function parseHeldEventCreate(
  heldAtInput: string,
): { kind: "invalid"; message: string } | { kind: "ready"; request: CreateHeldEventRequest } {
  return heldAtInput
    ? { kind: "ready", request: { heldAt: toIsoFromLocalDateTime(heldAtInput) } }
    : { kind: "invalid", message: "開催日時を入力してください。" };
}

export type HeldEventCreateForm = {
  readonly action: (formData: FormData) => void | Promise<void>;
  readonly errorMessage: string;
  readonly formKey: number;
  readonly open: boolean;
  readonly pending: boolean;
  readonly close: () => void;
};
