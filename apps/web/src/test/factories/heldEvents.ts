import type { HeldEventResponse } from "@/shared/api/heldEvents";

const defaultHeldAt = "2026-01-01T00:00:00.000Z";

export function makeHeldEventResponse(
  overrides: Partial<HeldEventResponse> = {},
): HeldEventResponse {
  return {
    heldAt: defaultHeldAt,
    id: "held-1",
    matchCount: 0,
    ...overrides,
  };
}
