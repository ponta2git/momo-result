// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildWorkspacePageCopy,
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
        heldAt: "2026-01-01T00:00:00.000Z",
        matchCount: 2,
      },
      {
        id: "new",
        heldAt: "2026-01-02T00:00:00.000Z",
        matchCount: 3,
      },
    ] as HeldEventResponse[];

    expect(latestHeldEventPatch(events)).toEqual({
      heldEventId: "new",
      matchNoInEvent: 4,
      playedAt: "2026-01-02T00:00:00.000Z",
    });
  });
});
