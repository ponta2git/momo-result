import { describe, expect, it } from "vitest";
import { buildOcrHints } from "@/features/ocrCapture/hints";

describe("buildOcrHints", () => {
  it("uses the canonical layout families and does not include result context fields", () => {
    expect(
      buildOcrHints({ gameTitleName: "桃太郎電鉄2", layoutFamily: "momotetsu_2" }),
    ).toMatchObject({
      gameTitle: "桃太郎電鉄2",
      layoutFamily: "momotetsu_2",
    });
    expect(
      buildOcrHints({ gameTitleName: "桃太郎電鉄ワールド", layoutFamily: "world" }),
    ).toMatchObject({
      layoutFamily: "world",
    });
    expect(buildOcrHints({ gameTitleName: "令和", layoutFamily: "reiwa" })).toMatchObject({
      layoutFamily: "reiwa",
    });

    const hints = buildOcrHints({ gameTitleName: "桃太郎電鉄2", layoutFamily: "momotetsu_2" });
    expect(hints).not.toHaveProperty("season");
    expect(hints).not.toHaveProperty("map");
    expect(hints).not.toHaveProperty("owner");
  });

  it("builds known player aliases for the fixed four members", () => {
    const aliases =
      buildOcrHints({ gameTitleName: "桃太郎電鉄2", layoutFamily: "momotetsu_2" })
        .knownPlayerAliases ?? [];

    expect(aliases.map((alias) => alias.memberId)).toEqual([
      "member_ponta",
      "member_akane_mami",
      "member_otaka",
      "member_eu",
    ]);
    expect(aliases.find((alias) => alias.memberId === "member_akane_mami")?.aliases).toContain(
      "NO11社長",
    );
    expect(aliases.find((alias) => alias.memberId === "member_otaka")?.aliases).toContain(
      "オータカ社長",
    );
  });

  it("sends computer aliases only for the Reiwa layout family", () => {
    expect(
      buildOcrHints({ gameTitleName: "令和", layoutFamily: "reiwa" }).computerPlayerAliases,
    ).toEqual(["さくま"]);
    expect(
      buildOcrHints({ gameTitleName: "桃太郎電鉄2", layoutFamily: "momotetsu_2" })
        .computerPlayerAliases,
    ).toEqual([]);
    expect(
      buildOcrHints({ gameTitleName: "ワールド", layoutFamily: "world" }).computerPlayerAliases,
    ).toEqual([]);
  });

  it("falls back to empty hints when the game title is not yet resolved", () => {
    const hints = buildOcrHints({});
    expect(hints.gameTitle).toBeUndefined();
    expect(hints.layoutFamily).toBeUndefined();
    expect(hints.computerPlayerAliases).toEqual([]);
    expect(hints.knownPlayerAliases?.length).toBe(4);
  });
});
