import type {
  SeriesPlayerRadarBasisRecord,
  SeriesPlayerRadarEvaluation,
  SeriesPlayerRadarOperation,
  SeriesPlayerRadarPreview,
  SeriesPlayerRadarState,
} from "@/shared/api/seriesPlayerRadar";
import { canonicalResultMembers } from "@/shared/domain/members";

import basisFixture from "../../../../../docs/schemas/fixtures/series-analysis/radar-basis-v1.json" with { type: "json" };
import candidateFixture from "../../../../../docs/schemas/fixtures/series-analysis/radar-candidate-v1.json" with { type: "json" };
import evaluationFixture from "../../../../../docs/schemas/fixtures/series-analysis/radar-evaluation-v1.json" with { type: "json" };

export function makePlayerRadarBasis(): SeriesPlayerRadarBasisRecord {
  return {
    achievementCurve: { thresholds: [0, 10, 25, 50, 80] },
    basisId: "radar-basis-current",
    checksum: "sha256:20aa7a12379a61df6e336890b4bd0a3612ce86316209cc1617abf0cffd0f1ec4",
    createdAt: "2026-09-01T00:00:00Z",
    appliedAt: "2026-09-01T00:01:00Z",
    sourceInputRevision: "12",
    basis: structuredClone(basisFixture) as SeriesPlayerRadarBasisRecord["basis"],
  };
}

export function makePlayerRadarEvaluation(): SeriesPlayerRadarEvaluation {
  const result = structuredClone(evaluationFixture) as unknown as SeriesPlayerRadarEvaluation;
  result.players.forEach((player, index) => {
    player.memberId = canonicalResultMembers[index]?.memberId ?? player.memberId;
  });
  return result;
}

export function makePlayerRadarState(gameTitleId = "gt_momotetsu_2"): SeriesPlayerRadarState {
  return {
    schemaVersion: 1,
    gameTitleId,
    inputRevision: "12",
    generation: "0",
    currentBasis: null,
    previousBasis: null,
    candidate: null,
    operations: [],
    monitor: null,
    acknowledgedEvidenceKeys: [],
    eligibility: { matchCount: 12, heldEventCount: 3 },
  };
}

export function makeReadyPlayerRadarState(): SeriesPlayerRadarState {
  const state = makePlayerRadarState();
  state.currentBasis = makePlayerRadarBasis();
  state.eligibility = { matchCount: 40, heldEventCount: 8 };
  state.candidate = {
    achievementCurve: { thresholds: [0, 10, 25, 50, 80] },
    originKind: "generated",
    manualInput: null,
    sourceBasisId: null,
    sourceCandidateId: null,
    sourceBasis: null,
    savedBy: null,
    candidateId: "radar-candidate",
    status: "ready",
    basisId: "radar-basis-candidate",
    sourceInputRevision: "12",
    safeFailureCode: null,
    createdAt: "2026-09-02T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    result: structuredClone(candidateFixture) as unknown as NonNullable<
      NonNullable<SeriesPlayerRadarState["candidate"]>["result"]
    >,
    latestPreview: {
      previewId: "radar-preview",
      beforeBasisId: "radar-basis-current",
      inputRevision: "12",
      status: "ready",
      createdAt: "2026-09-02T00:00:00Z",
    },
  };
  return state;
}

export function makePlayerRadarPreview(): SeriesPlayerRadarPreview {
  return {
    schemaVersion: 1,
    gameTitleId: "gt_momotetsu_2",
    previewId: "radar-preview",
    candidateId: "radar-candidate",
    inputRevision: "12",
    currentInputRevision: "12",
    beforeBasisId: "radar-basis-current",
    candidateBasisId: "radar-basis-candidate",
    status: "ready",
    createdAt: "2026-09-02T00:00:00Z",
    scope: {
      kind: "overall",
      key: "overall",
      seasonMasterId: null,
      mapMasterId: null,
      displayName: "全期間・全マップ",
      state: "available",
    },
    beforeAchievements: makePlayerRadarAchievements(),
    afterAchievements: makePlayerRadarAchievements(),
    before: makePlayerRadarEvaluation(),
    after: makePlayerRadarEvaluation(),
  };
}

export function makePlayerRadarOperation(
  kind: SeriesPlayerRadarOperation["kind"] = "apply",
): SeriesPlayerRadarOperation {
  return {
    schemaVersion: 1,
    operationId: "radar-operation",
    gameTitleId: "gt_momotetsu_2",
    kind,
    status: "pending",
    candidateId: "radar-candidate",
    previewId: "radar-preview",
    basisId: "radar-basis-candidate",
    originOperationId: null,
    safeFailureCode: null,
    requestedAt: "2026-09-02T00:01:00Z",
    finishedAt: null,
  };
}

export function makePlayerRadarAchievements(): NonNullable<
  SeriesPlayerRadarPreview["afterAchievements"]
> {
  return {
    achievementCurve: { thresholds: [0, 10, 25, 50, 80] },
    summary: {
      mapMasterId: null,
      totalPoints: 100,
      players: canonicalResultMembers.map(({ memberId }, index) => ({
        memberId,
        earnedPoints: [50, 25, 10, 0][index] ?? 0,
        score: [7, 5, 3, 1][index] ?? 1,
      })) as NonNullable<SeriesPlayerRadarPreview["afterAchievements"]>["summary"]["players"],
    },
  };
}
