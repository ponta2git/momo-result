import type { AchievementResource } from "@/shared/api/achievements";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import type {
  SeriesPlayerRadarBasisRecord,
  SeriesPlayerRadarEvaluation,
  SeriesPlayerRadarPreview,
} from "@/shared/api/seriesPlayerRadar";
import { memberDisplayName } from "@/shared/domain/members";
import { defaultAchievementCurve } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type {
  PlayerAchievementCurve,
  PlayerRadarBasis,
  PlayerRadarDisplay,
  PlayerRadarSample,
} from "@/shared/seriesAnalysis/playerRadarPresentation";

type DisplayMap = { mapMasterId: string; displayName: string | null };
type DisplayMember = { memberId: string; displayName: string };
type SampleSource = Pick<
  SeriesPlayerRadarEvaluation["sample"],
  "matchCount" | "heldEventCount" | "firstMatch" | "lastMatch" | "mapCounts"
>;

export function playerRadarSampleDisplay(
  source: SampleSource,
  maps: readonly DisplayMap[],
): PlayerRadarSample {
  return {
    matchCount: source.matchCount,
    heldEventCount: source.heldEventCount,
    firstPlayedAt: source.firstMatch?.playedAt ?? null,
    lastPlayedAt: source.lastMatch?.playedAt ?? null,
    maps: source.mapCounts.map((map) => ({
      ...map,
      displayName:
        maps.find((entry) => entry.mapMasterId === map.mapMasterId)?.displayName ??
        `現在の登録にないマップ（${map.mapMasterId}）`,
    })),
  };
}

export function playerRadarBasisDisplay(
  record: Pick<SeriesPlayerRadarBasisRecord, "basisId" | "appliedAt" | "basis"> & {
    createdAt: string | null;
    achievementCurve?: PlayerAchievementCurve;
  },
  maps: readonly DisplayMap[],
): PlayerRadarBasis {
  return {
    basisId: record.basisId,
    achievementCurve:
      record.achievementCurve ?? record.basis.achievementCurve ?? defaultAchievementCurve,
    createdAt: record.createdAt,
    appliedAt: record.appliedAt,
    definitionVersion: record.basis.definitionVersion,
    methodVersion: record.basis.methodVersion,
    source: playerRadarSampleDisplay(record.basis.source, maps),
    axes: record.basis.axes.map((axis) => ({
      axisId: axis.axisId,
      thresholds: axis.thresholds.map((rawValue, index) => ({ score: index + 2, rawValue })),
    })),
  };
}

export function playerRadarAggregateDisplay(
  response: SeriesComparisonAggregate,
  achievements?: AchievementResource,
): PlayerRadarDisplay {
  const radar = response.playerRadar;
  const basis = radar.basis
    ? playerRadarBasisDisplay(
        {
          ...radar.basis,
          createdAt: response.artifact.radarBasisCreatedAt,
          appliedAt: response.artifact.radarBasisAppliedAt,
        },
        radar.basis.basis.source.mapCounts,
      )
    : null;
  const summary = achievements?.summaries.find(
    (entry) =>
      entry.mapMasterId === ("mapMasterId" in response.scope ? response.scope.mapMasterId : null),
  );
  return playerRadarEvaluationDisplay(
    radar.evaluation,
    basis,
    radar.evaluation.sample.mapCounts,
    response.players,
    summary ? { summary } : undefined,
  );
}

/** Joins display identities only; values, quality, scores and thresholds stay server-owned. */
export function playerRadarEvaluationDisplay(
  evaluation: SeriesPlayerRadarEvaluation,
  basis: PlayerRadarBasis | null,
  maps: readonly DisplayMap[],
  members: readonly DisplayMember[] = [],
  achievements?: Pick<NonNullable<SeriesPlayerRadarPreview["afterAchievements"]>, "summary"> | null,
): PlayerRadarDisplay {
  return {
    basis,
    sample: {
      ...playerRadarSampleDisplay(evaluation.sample, maps),
      quality: evaluation.sample.quality,
    },
    players: evaluation.players.map((player) => ({
      memberId: player.memberId,
      displayName:
        members.find((member) => member.memberId === player.memberId)?.displayName ??
        memberDisplayName(player.memberId),
      axes: player.axes,
      ...(achievements
        ? {
            achievement: {
              earnedPoints:
                achievements.summary.players.find((entry) => entry.memberId === player.memberId)
                  ?.earnedPoints ?? 0,
              totalPoints: achievements.summary.totalPoints,
              score:
                achievements.summary.players.find((entry) => entry.memberId === player.memberId)
                  ?.score ?? null,
            },
          }
        : {}),
    })),
  };
}
