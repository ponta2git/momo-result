import { describe, expect, it } from "vitest";
import {
  confirmMatch,
  createHeldEvent,
  getOcrDraftsBulk,
  listHeldEvents,
} from "@/features/draftReview/api";

describe("draft review api", () => {
  it("loads held events", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    await expect(listHeldEvents()).resolves.toMatchObject({
      items: [{ id: "held-1" }],
    });
  });

  it("creates held event and confirms match", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    await expect(
      createHeldEvent({ name: "作成", heldAt: "2026-01-01T00:00:00.000Z" }),
    ).resolves.toMatchObject({ id: "held-created" });

    await expect(
      confirmMatch({
        heldEventId: "held-1",
        matchNoInEvent: 1,
        gameTitle: "桃太郎電鉄2",
        layoutFamily: "momotetsu_2",
        seasonId: "season-current",
        ownerMemberId: "ponta",
        mapName: "東日本編",
        playedAt: "2026-01-01T00:00:00.000Z",
        draftIds: {},
        players: [],
      }),
    ).resolves.toMatchObject({ matchId: "match-1" });
  });

  it("loads OCR drafts in bulk", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    await expect(getOcrDraftsBulk(["draft-1", "draft-2"])).resolves.toMatchObject({
      items: [{ draftId: "draft-1" }, { draftId: "draft-2" }],
    });
  });
});
