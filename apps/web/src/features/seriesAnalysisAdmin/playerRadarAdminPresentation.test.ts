import { describe, expect, it } from "vitest";

import { radarReviewPresentation } from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import type { SeriesPlayerRadarState } from "@/shared/api/seriesPlayerRadar";
import {
  makePlayerRadarEvaluation,
  makeReadyPlayerRadarState,
} from "@/test/msw/playerRadarFixtures";

type Monitor = NonNullable<SeriesPlayerRadarState["monitor"]>;

function monitoringWindow(
  firstPlayedAt: string,
  lastPlayedAt: string,
): Monitor["latestWindows"][number] {
  const evaluation = makePlayerRadarEvaluation();
  const firstMatch = {
    heldEventId: `${firstPlayedAt}-event`,
    matchId: `${firstPlayedAt}-match`,
    matchNoInEvent: 1,
    playedAt: firstPlayedAt,
  };
  const lastMatch = { ...firstMatch, matchId: `${lastPlayedAt}-match`, playedAt: lastPlayedAt };
  return {
    firstMatch,
    lastMatch,
    evaluation: {
      ...evaluation,
      sample: {
        firstMatch,
        lastMatch,
        matchCount: 20,
        heldEventCount: 5,
        mapCounts: [{ mapMasterId: "map-1", matchCount: 20 }],
        quality: "reference",
      },
    },
  };
}

function monitoredState(): SeriesPlayerRadarState & { monitor: Monitor } {
  return {
    ...makeReadyPlayerRadarState(),
    monitor: {
      status: "ready",
      completedWindowCount: 3,
      evaluatedHeldEventCount: 9,
      evaluatedMatchCount: 40,
      pendingMatchCount: 7,
      postSourceMatchCount: 67,
      latestWindows: [
        monitoringWindow("2026-07-01T01:00:00Z", "2026-07-20T02:00:00Z"),
        monitoringWindow("2026-07-21T03:00:00Z", "2026-08-10T04:00:00Z"),
      ],
      reasons: [
        {
          kind: "high_score_concentration",
          axisIds: ["totalAssetsP90"],
          evidenceChecksum: "high-score-evidence",
          mapMasterIds: [],
        },
      ],
    },
  };
}

describe("radarReviewPresentation", () => {
  it("shows the saved windows and unique event count without adding overlapping event counts", () => {
    const state = monitoredState();
    state.acknowledgedEvidenceKeys = ["high-score-evidence"];

    const result = radarReviewPresentation(state);

    expect(result.explanation).toBeNull();
    expect(result.reasons[0]).toMatchObject({
      evidenceKey: "high-score-evidence",
      acknowledged: true,
      evidence: [
        { label: "対象記録", value: "40試合・9開催" },
        {
          label: "1つ目の期間",
          value: "2026/07/01 10:00〜2026/07/20 11:00（20試合・5開催）",
        },
        {
          label: "2つ目の期間",
          value: "2026/07/21 12:00〜2026/08/10 13:00（20試合・5開催）",
        },
      ],
    });
    expect(result.reasons[0]?.label).toContain("総資産（高め）");
    expect(result.reasons[0]?.label).toContain("4人中3人以上が9点以上");
  });

  it("does not attach concentration windows to other review reasons", () => {
    const state = monitoredState();
    state.monitor.reasons = [
      { kind: "source_changed", axisIds: [], mapMasterIds: [], evidenceChecksum: "source" },
      { kind: "new_map", axisIds: [], mapMasterIds: ["map-2"], evidenceChecksum: "map" },
    ];

    expect(radarReviewPresentation(state).reasons.map((reason) => reason.evidence)).toEqual([
      [],
      [],
    ]);
  });

  it("explains insufficient events using the evaluated windows rather than all later matches", () => {
    const state = monitoredState();
    state.monitor.status = "insufficient_events";
    state.monitor.evaluatedHeldEventCount = 6;
    state.monitor.reasons = [];

    const result = radarReviewPresentation(state);

    expect(result.explanation).toContain("直近の対象40試合は6開催分");
    expect(result.explanation).toContain("対象の2期間で8開催以上");
    expect(result.explanation).not.toContain("67試合");
  });
});
