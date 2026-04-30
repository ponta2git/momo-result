import { describe, expect, it } from "vitest";
import { buildOcrHints } from "@/features/ocrCapture/hints";

describe("buildOcrHints", () => {
  it("uses the canonical layout families and does not include result context fields", () => {
    expect(buildOcrHints({ gameTitleId: "momotetsu_2" })).toMatchObject({
      layoutFamily: "momotetsu_2",
    });
    expect(buildOcrHints({ gameTitleId: "world" })).toMatchObject({
      layoutFamily: "world",
    });
    expect(buildOcrHints({ gameTitleId: "reiwa" })).toMatchObject({
      layoutFamily: "reiwa",
    });

    const hints = buildOcrHints({ gameTitleId: "momotetsu_2" });
    expect(hints).not.toHaveProperty("season");
    expect(hints).not.toHaveProperty("map");
    expect(hints).not.toHaveProperty("owner");
  });

  it("builds known player aliases for the fixed four members", () => {
    const aliases = buildOcrHints({ gameTitleId: "momotetsu_2" }).knownPlayerAliases ?? [];

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
    expect(buildOcrHints({ gameTitleId: "reiwa" }).computerPlayerAliases).toEqual(["さくま"]);
    expect(buildOcrHints({ gameTitleId: "momotetsu_2" }).computerPlayerAliases).toEqual([]);
    expect(buildOcrHints({ gameTitleId: "world" }).computerPlayerAliases).toEqual([]);
  });
});
