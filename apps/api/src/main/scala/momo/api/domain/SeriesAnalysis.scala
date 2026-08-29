package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.{AccountId, GameTitleId, MapMasterId, MatchId, MemberId, SeasonMasterId}

object SeriesAnalysisVocabulary:
  val EnvelopeSchemaVersion = 1
  val JobStatuses: List[String] = List("queued", "running", "succeeded", "failed", "timed_out")
  val TriggersByPriority: List[String] = List(
    "manual",
    "artifact_schema_update",
    "algorithm_update",
    "initial_backfill",
    "match_mutation",
  )
  val ArtifactFreshness: List[String] = List("current", "stale", "unavailable")
  val RequestedBy: List[String] = List("administrator", "mixed", "system")
  val ResultDispositions: List[String] = List("none", "published", "reused")
  val RequestDispositions: List[String] = List(
    "coalesced_into_queued_job",
    "created_job",
    "forced_run_reserved",
  )
  val AcceptedCampaignStatuses: List[String] = List("expanding")
  val SafeFailureCodes: List[String] = List(
    "input_contract_invalid",
    "input_revision_violation",
    "calculation_failed",
    "artifact_validation_failed",
    "artifact_too_large",
    "non_deterministic_output",
    "dependency_retry_exhausted",
    "lease_recovery_exhausted",
    "worker_crashed",
    "hard_timeout",
    "resource_exhausted",
    "temporary_storage_exhausted",
    "publication_failed",
  )
end SeriesAnalysisVocabulary

final case class SeriesAnalysisDesiredVersion(
    inputRevision: Long,
    algorithmVersion: String,
    artifactSchemaVersion: Int,
)

final case class SeriesAnalysisArtifactRef(
    artifactId: String,
    gameTitleId: GameTitleId,
    inputRevision: Long,
    algorithmVersion: String,
    artifactSchemaVersion: Int,
    publishedAt: Instant,
)

final case class SeriesAnalysisCalculation(
    status: String,
    trigger: String,
    requestedAt: Instant,
    startedAt: Option[Instant],
    finishedAt: Option[Instant],
)

final case class SeriesAnalysisStatus(
    gameTitleId: GameTitleId,
    desired: SeriesAnalysisDesiredVersion,
    artifactFreshness: String,
    currentArtifact: Option[SeriesAnalysisArtifactRef],
    calculation: Option[SeriesAnalysisCalculation],
)

enum SeriesAnalysisScope derives CanEqual:
  case Overall
  case Season(id: SeasonMasterId)
  case Map(id: MapMasterId)
  case SeasonMap(seasonId: SeasonMasterId, mapId: MapMasterId)

  def kind: String = this match
    case Overall => "overall"
    case Season(_) => "season"
    case Map(_) => "map"
    case SeasonMap(_, _) => "season_map"

  def seasonMasterId: Option[SeasonMasterId] = this match
    case Season(id) => Some(id)
    case SeasonMap(id, _) => Some(id)
    case Overall | Map(_) => None

  def mapMasterId: Option[MapMasterId] = this match
    case Map(id) => Some(id)
    case SeasonMap(_, id) => Some(id)
    case Overall | Season(_) => None

  def key: String = this match
    case Overall => "overall"
    case Season(id) => s"season:${id.value}"
    case Map(id) => s"map:${id.value}"
    case SeasonMap(seasonId, mapId) => s"season_map:${seasonId.value}:${mapId.value}"

enum SeriesAnalysisDrilldownMetric(val id: String) derives CanEqual:
  case RankAverageHistory extends SeriesAnalysisDrilldownMetric("rank.averageHistory")
  case PlayOrderRankHistory extends SeriesAnalysisDrilldownMetric("playOrder.rankHistory")
  case RankSignals extends SeriesAnalysisDrilldownMetric("rankAnalysis.rankSignals")
  case UnexpectedWins extends SeriesAnalysisDrilldownMetric("rankAnalysis.unexpectedWins")

object SeriesAnalysisDrilldownMetric:
  def fromId(id: String): Option[SeriesAnalysisDrilldownMetric] = values.find(_.id == id)

  val supportedIds: List[String] = values.map(_.id).toList

final case class SeriesAnalysisSeasonOption(id: SeasonMasterId, displayName: String)
final case class SeriesAnalysisMapOption(id: MapMasterId, displayName: String)
final case class SeriesAnalysisSeasonMapPair(
    seasonMasterId: SeasonMasterId,
    mapMasterId: MapMasterId,
)
final case class SeriesAnalysisTitleOption(
    gameTitleId: GameTitleId,
    displayName: String,
    confirmedMatchCount: Long,
    seasons: List[SeriesAnalysisSeasonOption],
    maps: List[SeriesAnalysisMapOption],
    seasonMapPairs: List[SeriesAnalysisSeasonMapPair],
)
final case class SeriesAnalysisOptions(
    defaultGameTitleId: Option[GameTitleId],
    titles: List[SeriesAnalysisTitleOption],
)

final case class SeriesAnalysisChunk(
    artifact: SeriesAnalysisArtifactRef,
    scope: SeriesAnalysisScope,
    payload: Array[Byte],
)

enum SeriesAnalysisChunkKind derives CanEqual:
  case Aggregate, Review, Drilldown, MatchContext

enum SeriesAnalysisMatchContextExclusion(val wire: String) derives CanEqual:
  case MatchChangedSinceArtifact
      extends SeriesAnalysisMatchContextExclusion("match_changed_since_artifact")
  case NotInArtifact extends SeriesAnalysisMatchContextExclusion("not_in_artifact")
  case NotInScope extends SeriesAnalysisMatchContextExclusion("not_in_scope")

final case class SeriesAnalysisChunkRequest(
    kind: SeriesAnalysisChunkKind,
    gameTitleId: GameTitleId,
    artifactId: String,
    scope: SeriesAnalysisScope,
    memberId: Option[MemberId] = None,
    metric: Option[SeriesAnalysisDrilldownMetric] = None,
    matchId: Option[MatchId] = None,
)

final case class SeriesAnalysisRecalculationAccepted(
    requestId: String,
    acceptedAt: Instant,
    targetCount: Int,
    campaign: Option[SeriesAnalysisAcceptedCampaign],
    target: Option[SeriesAnalysisAcceptedTarget],
)
final case class SeriesAnalysisAcceptedCampaign(campaignId: String, status: String)
final case class SeriesAnalysisAcceptedTarget(
    gameTitleId: GameTitleId,
    jobId: Option[String],
    requestDisposition: String,
)

final case class SeriesAnalysisPendingManualRun(requestCount: Int, oldestRequestedAt: Instant)
final case class SeriesAnalysisCampaignSummary(
    campaignId: String,
    targetCount: Int,
    expandedCount: Int,
    terminalCount: Int,
    failedCount: Int,
    skippedCount: Int,
    acceptedAt: Instant,
)
final case class SeriesAnalysisGlobalExecution(
    runningCount: Int,
    queuedTitleCount: Int,
    oldestQueuedAt: Option[Instant],
    activeCampaignCount: Int,
    latestActiveCampaign: Option[SeriesAnalysisCampaignSummary],
)
final case class SeriesAnalysisRequester(accountId: AccountId, displayName: String)
final case class SeriesAnalysisJobSummary(
    jobId: String,
    gameTitleId: GameTitleId,
    gameTitleName: String,
    status: String,
    trigger: String,
    coalescedTriggers: List[String],
    requestedBy: String,
    manualRequestCount: Int,
    requestedAt: Instant,
    startedAt: Option[Instant],
    finishedAt: Option[Instant],
    elapsedMilliseconds: Option[Long],
    inputRevision: Long,
    algorithmVersion: String,
    attemptCount: Int,
    transientRetryCount: Int,
    leaseRecoveryCount: Int,
    queueWaitMilliseconds: Option[Long],
    resultDisposition: String,
    firstManualRequester: Option[SeriesAnalysisRequester],
    safeFailureCode: Option[String],
)
final case class SeriesAnalysisSelectedTitle(
    gameTitleId: GameTitleId,
    gameTitleName: String,
    status: SeriesAnalysisStatus,
    pendingManualRun: Option[SeriesAnalysisPendingManualRun],
)
final case class SeriesAnalysisAdminOverview(
    titleOptions: List[SeriesAnalysisTitleOption],
    selectedTitle: Option[SeriesAnalysisSelectedTitle],
    globalExecution: SeriesAnalysisGlobalExecution,
    recentJobs: List[SeriesAnalysisJobSummary],
)
