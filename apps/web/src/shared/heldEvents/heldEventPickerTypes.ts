import type {
  HeldEventListResponse,
  HeldEventResponse,
  HeldEventSummaryResponse,
} from "@/shared/api/heldEvents";

/** Shared candidate-directory contract, independent of its query and state owner. */
export type HeldEventPickerDirectory = {
  error: string | undefined;
  heldEvents: HeldEventResponse[];
  pagination: HeldEventListResponse["pagination"] | undefined;
  pending: boolean;
  refetch: (options?: { throwOnError?: boolean }) => Promise<void>;
  selectedHeldEvent: HeldEventResponse | HeldEventSummaryResponse | undefined;
  onPageChange: (page: number) => void;
  scopeChanging: boolean;
};
