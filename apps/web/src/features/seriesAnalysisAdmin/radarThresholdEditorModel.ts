import type { RadarManualInput } from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import type {
  SeriesAnalysisScopeStatus,
  SeriesAnalysisScopeStatusQuery,
} from "@/shared/api/seriesPlayerRadar";
import { playerRadarAggregateDisplay } from "@/shared/seriesAnalysis/playerRadarDisplay";
import type {
  PlayerRadarBasis,
  PlayerRadarDisplay,
} from "@/shared/seriesAnalysis/playerRadarPresentation";

export type RadarEditingSource = {
  label: string;
  basis: PlayerRadarBasis;
  input: RadarManualInput;
  sourceBasisId: string;
  sourceCandidateId: string | null;
  expectedCurrentBasisId: string | null;
  expectedCandidateId: string | null;
  savedCandidateId: string | null;
};

export type RadarManualSave = {
  expectedCurrentBasisId: string | null;
  expectedCandidateId: string | null;
  sourceBasisId: string;
  sourceCandidateId: string | null;
  manualInput: RadarManualInput;
};

export type RadarPreparedCandidate = { candidateId: string; operationId: string };

export type RadarEditingModel = {
  acceptedApply?: { operationId: string; candidateId: string } | null;
  acceptedSave?: (RadarPreparedCandidate & { request: RadarManualSave }) | null;
  current: RadarEditingSource | null;
  candidate: RadarEditingSource | null;
  evaluation: {
    key: string;
    before: PlayerRadarDisplay | null;
    raw: PlayerRadarDisplay;
    createdAt: string;
  } | null;
  evaluationMessage: string | null;
  evaluationUpdating: boolean;
  permissionReason: string | null;
  saveDisabledReason: string | null;
  onActiveChange: (active: boolean) => void;
  save: (request: RadarManualSave) => Promise<RadarPreparedCandidate>;
  discard: (prepared: RadarPreparedCandidate) => Promise<void>;
  reuseCandidate: (candidateId: string) => Promise<void>;
};

/** Saved evaluations are usable only for the current publication, scope and applied basis. */
export function radarEditingEvaluation({
  active,
  currentBasisId,
  scope,
  prepared,
  query,
  aggregate,
  scopeState,
  fetching,
  failed,
}: {
  active: boolean;
  currentBasisId: string | null;
  scope: { seasonMasterId: string; mapMasterId: string };
  prepared: RadarEditingModel["evaluation"];
  query: SeriesAnalysisScopeStatusQuery | undefined;
  aggregate: SeriesComparisonAggregate | undefined;
  scopeState: SeriesAnalysisScopeStatus["state"] | undefined;
  fetching: boolean;
  failed: boolean;
}) {
  const usePublished = active && !prepared;
  const matchingBasis = (aggregate?.playerRadar.basis?.basisId ?? null) === currentBasisId;
  const matchingScope =
    aggregate &&
    query &&
    aggregate.artifact.artifactId === query.artifactId &&
    ("seasonMasterId" in aggregate.scope ? aggregate.scope.seasonMasterId : "") ===
      scope.seasonMasterId &&
    ("mapMasterId" in aggregate.scope ? aggregate.scope.mapMasterId : "") === scope.mapMasterId;
  const valid = usePublished && matchingScope && matchingBasis && scopeState === "available";
  const display = valid ? playerRadarAggregateDisplay(aggregate) : null;
  const evaluation: RadarEditingModel["evaluation"] = active
    ? (prepared ??
      (display && aggregate
        ? {
            key: `${aggregate.artifact.artifactId}:${scope.seasonMasterId}:${scope.mapMasterId}`,
            before: display,
            raw: display,
            createdAt: aggregate.artifact.publishedAt,
          }
        : null))
    : null;
  const loading = usePublished && fetching;
  const error = usePublished && failed;
  const message =
    evaluation || !active
      ? null
      : loading
        ? "比較に使う保存済みの成績を読み込み中です。"
        : error
          ? "比較を読み込めません。入力を保持したまま基準の状態を更新してください。"
          : scopeState === "empty"
            ? "この比較条件に対象試合はありません。入力はそのまま保存できます。"
            : aggregate && !matchingBasis
              ? "分析結果と適用中の基準が異なります。最新の分析結果を読み込んでください。"
              : "比較に使える分析結果がありません。案を保存し、正式な比較を計算してください。";
  return { evaluation, loading, message };
}
