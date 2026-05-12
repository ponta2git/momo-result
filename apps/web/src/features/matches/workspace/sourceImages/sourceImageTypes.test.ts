// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toSourceImageDescriptor } from "@/features/matches/workspace/sourceImages/sourceImageTypes";

describe("toSourceImageDescriptor", () => {
  it("accepts only known source image kinds and draft-scoped API URLs", () => {
    expect(
      toSourceImageDescriptor("draft-1", {
        createdAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "/api/match-drafts/draft-1/source-images/total_assets",
        kind: "total_assets",
      }),
    ).toMatchObject({
      imageUrl: "/api/match-drafts/draft-1/source-images/total_assets",
      kind: "total_assets",
    });

    expect(
      toSourceImageDescriptor("draft-1", {
        createdAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "https://example.com/image.png",
        kind: "total_assets",
      }),
    ).toBeUndefined();
    expect(
      toSourceImageDescriptor("draft-1", {
        createdAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "/api/match-drafts/draft-2/source-images/total_assets",
        kind: "total_assets",
      }),
    ).toBeUndefined();
    expect(
      toSourceImageDescriptor("draft-1", {
        createdAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "/api/match-drafts/draft-1/source-images/unknown",
        kind: "unknown",
      }),
    ).toBeUndefined();
  });
});
