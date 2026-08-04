// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildWorkspacePageCopy,
  heldEventPatchById,
  latestHeldEventPatch,
} from "@/features/matches/workspace/workspaceViewModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";

describe("workspaceViewModel", () => {
  it("builds review page copy from the current draft status", () => {
    expect(buildWorkspacePageCopy({ mode: "review", reviewStatus: "ocr_running" })).toMatchObject({
      title: "OCR結果の確認",
      description: expect.stringContaining("処理中"),
    });
  });

  it("selects the newest held event as the default patch", () => {
    const events = [
      {
        id: "old",
        draftCount: 0,
        heldAt: "2026-01-01T00:00:00.000Z",
        matchCount: 2,
        nextMatchNo: 3,
      },
      {
        id: "new",
        draftCount: 1,
        heldAt: "2026-01-02T00:00:00.000Z",
        matchCount: 3,
        nextMatchNo: 7,
      },
    ] as HeldEventResponse[];

    expect(latestHeldEventPatch(events)).toEqual({
      heldEventId: "new",
      matchNoInEvent: 7,
      playedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("prefers the requested held event and uses its server-supplied next number", () => {
    const events = [
      {
        draftCount: 1,
        heldAt: "2026-01-01T00:00:00.000Z",
        id: "requested",
        matchCount: 2,
        nextMatchNo: 9,
      },
    ];

    expect(heldEventPatchById(events, "requested")).toEqual({
      heldEventId: "requested",
      matchNoInEvent: 9,
      playedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(heldEventPatchById(events, "missing")).toBeUndefined();
  });
});
