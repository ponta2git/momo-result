import type { HeldEventResponse } from "@/shared/api/heldEvents";

export function canDeleteHeldEvent(
  event: Readonly<Pick<HeldEventResponse, "matchCount" | "draftCount">>,
): boolean {
  return event.matchCount === 0 && event.draftCount === 0;
}

export type HeldEventDeleteConfirmation = {
  readonly cancel: () => void;
  readonly confirm: () => Promise<void>;
  readonly pending: boolean;
  readonly target: { readonly heldAt: string } | null;
};
