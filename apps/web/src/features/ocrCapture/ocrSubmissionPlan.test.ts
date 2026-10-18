// @vitest-environment node
import { describe, expect, it } from "vitest";

import { prepareOcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";

function prepare(layoutFamily: string | null | undefined) {
  return prepareOcrSubmissionPlan({
    setupResolution: {
      kind: "ready",
      value: {
        gameTitleId: "title-old",
        mapMasterId: "map-old",
        seasonMasterId: "season-old",
        ownerMemberId: "member_ponta",
      },
    },
    blockedReason: undefined,
    setupOptions: {
      selectedGameTitle: { id: "title-old", name: "作品", layoutFamily },
      selectedHeldEvent: undefined,
      mapMasters: [],
      seasonMasters: [],
    },
    slots: [{ kind: "incident_log", status: "selected", file: new File(["image"], "image.png") }],
    nowIso: "2026-01-01T00:00:00Z",
  });
}

describe("OCR confirmation plan layout", () => {
  it("snapshots canonical hints and title selection from legacy catalog values", () => {
    expect(prepare(" MOMOTETSU_REIWA ")).toMatchObject({
      kind: "ready",
      plan: {
        hints: { layoutFamily: "reiwa" },
        selectedGameTitle: { id: "title-old", layoutFamily: "reiwa" },
      },
    });
  });

  it.each(["auto", "unknown", ""])("blocks an unsupported catalog value %j", (layout) => {
    expect(prepare(layout)).toMatchObject({ kind: "blocked" });
  });

  it.each([undefined, null])("retains automatic selection for absent %j", (layout) => {
    const result = prepare(layout);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.plan.hints).not.toHaveProperty("layoutFamily");
      expect(result.plan.selectedGameTitle).not.toHaveProperty("layoutFamily");
    }
  });
});
