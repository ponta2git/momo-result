import type { HeldEventDetailResponse, HeldEventResponse } from "@/shared/api/heldEvents";

const defaultHeldAt = "2026-01-01T00:00:00.000Z";

export function makeHeldEventResponse(
  overrides: Partial<HeldEventResponse> = {},
): HeldEventResponse {
  const matchCount = overrides.matchCount ?? 0;
  return {
    draftCount: 0,
    heldAt: defaultHeldAt,
    id: "held-1",
    matchCount,
    nextMatchNo: matchCount + 1,
    ...overrides,
  };
}

export function makeHeldEventDetailResponse(
  overrides: Partial<HeldEventDetailResponse> = {},
): HeldEventDetailResponse {
  return {
    draftCount: 0,
    drafts: [],
    heldAt: defaultHeldAt,
    id: "held-1",
    matchCount: 0,
    matches: [],
    nextMatchNo: 1,
    ...overrides,
  };
}
