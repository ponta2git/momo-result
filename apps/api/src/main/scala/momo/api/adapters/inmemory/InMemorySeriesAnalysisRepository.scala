package momo.api.adapters.inmemory

import java.time.Instant
import java.util.UUID

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.{GameTitlesRepository, SeriesAnalysisRepository}

final class InMemorySeriesAnalysisRepository[F[_]: Sync] private (
    gameTitles: GameTitlesRepository[F],
    now: F[Instant],
    state: Ref[F, InMemorySeriesAnalysisRepository.State],
) extends SeriesAnalysisRepository[F]:
  import InMemorySeriesAnalysisRepository.*

  override def options: F[Either[AppError, SeriesAnalysisOptions]] = gameTitles.list.map { titles =>
    val sorted = titles.sortBy(value => (value.displayOrder, value.id.value))
    SeriesAnalysisOptions(
      sorted.headOption.map(_.id),
      sorted.map(value => SeriesAnalysisTitleOption(value.id, value.name, 0, Nil, Nil, Nil)),
    ).asRight
  }

  override def status(
      gameTitleId: GameTitleId
  ): F[Either[AppError, SeriesAnalysisStatus]] = gameTitles.find(gameTitleId).flatMap {
    case None => AppError.NotFound("game title", gameTitleId.value).asLeft.pure[F]
    case Some(_) => state.get.map(snapshot => statusFor(gameTitleId, snapshot).asRight)
  }

  override def chunk(
      request: SeriesAnalysisChunkRequest
  ): F[Either[AppError, SeriesAnalysisChunk]] =
    AppError.AnalysisArtifactExpired().asLeft.pure[F]

  override def adminOverview(
      gameTitleId: Option[GameTitleId]
  ): F[Either[AppError, SeriesAnalysisAdminOverview]] =
    (options, state.get).mapN { (optionsResult, snapshot) =>
      optionsResult.flatMap { value =>
        val selectedId = gameTitleId.orElse(value.defaultGameTitleId)
        selectedId match
          case Some(id) if !value.titles.exists(_.gameTitleId == id) =>
            AppError.NotFound("game title", id.value).asLeft
          case _ =>
            val selected = selectedId.flatMap(id =>
              value.titles.find(_.gameTitleId == id).map(option =>
                SeriesAnalysisSelectedTitle(id, option.displayName, statusFor(id, snapshot), None)
              )
            )
            SeriesAnalysisAdminOverview(
              value.titles,
              selected,
              SeriesAnalysisGlobalExecution(
                runningCount = 0,
                queuedTitleCount = snapshot.jobs.size,
                oldestQueuedAt = snapshot.jobs.valuesIterator.map(_.requestedAt).minOption,
                activeCampaignCount = snapshot.campaigns.size,
                latestActiveCampaign = snapshot.campaigns.lastOption,
              ),
              snapshot.recent,
            ).asRight
      }
    }

  override def requestTitleRecalculation(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    val key = OperationKey(requestedBy, "title", idempotencyKeyHash)
    withReplay(key, Some(gameTitleId)) {
      gameTitles.find(gameTitleId).flatMap {
        case None => AppError.NotFound("game title", gameTitleId.value).asLeft.pure[F]
        case Some(title) =>
          for
            acceptedAt <- now
            operationId <- freshId
            candidateJob <- freshId.map(id => newJob(id, title, requestedBy, acceptedAt))
            result <- state.modify { snapshot =>
              replay(snapshot, key, Some(gameTitleId)) match
                case Some(existing) => snapshot -> existing
                case None =>
                  val existingJob = snapshot.jobs.get(gameTitleId)
                  val job = existingJob.fold(candidateJob)(value =>
                    value.copy(manualRequestCount = value.manualRequestCount + 1)
                  )
                  val disposition =
                    if existingJob.isDefined then "coalesced_into_queued_job" else "created_job"
                  val accepted = SeriesAnalysisRecalculationAccepted(
                    operationId,
                    acceptedAt,
                    1,
                    None,
                    Some(SeriesAnalysisAcceptedTarget(gameTitleId, Some(job.jobId), disposition)),
                  )
                  val recent = existingJob.fold((job :: snapshot.recent).take(10))(_ =>
                    snapshot.recent.map(value => if value.jobId == job.jobId then job else value)
                  )
                  snapshot.copy(
                    jobs = snapshot.jobs.updated(gameTitleId, job),
                    recent = recent,
                    operations = snapshot.operations.updated(key, accepted),
                  ) -> accepted.asRight
            }
          yield result
      }
    }

  override def requestAllRecalculation(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    val key = OperationKey(requestedBy, "all_titles", idempotencyKeyHash)
    withReplay(key, None) {
      gameTitles.list.flatMap {
        case Nil => AppError.AnalysisNoEligibleTitles().asLeft.pure[F]
        case titles =>
          for
            acceptedAt <- now
            operationId <- freshId
            campaignId <- freshId
            result <- state.modify { snapshot =>
              replay(snapshot, key, None) match
                case Some(existing) => snapshot -> existing
                case None =>
                  val accepted = SeriesAnalysisRecalculationAccepted(
                    operationId,
                    acceptedAt,
                    titles.size,
                    Some(SeriesAnalysisAcceptedCampaign(campaignId, "expanding")),
                    None,
                  )
                  val campaign = SeriesAnalysisCampaignSummary(
                    campaignId,
                    titles.size,
                    0,
                    0,
                    0,
                    0,
                    acceptedAt,
                  )
                  snapshot.copy(
                    operations = snapshot.operations.updated(key, accepted),
                    campaigns = snapshot.campaigns :+ campaign,
                  ) -> accepted.asRight
            }
          yield result
      }
    }

  private def withReplay(
      key: OperationKey,
      gameTitleId: Option[GameTitleId],
  )(fresh: => F[Either[AppError, SeriesAnalysisRecalculationAccepted]])
      : F[Either[AppError, SeriesAnalysisRecalculationAccepted]] =
    state.get.flatMap(snapshot => replay(snapshot, key, gameTitleId).fold(fresh)(_.pure[F]))

  private def freshId: F[String] = Sync[F].delay(UUID.randomUUID().toString)

  private def statusFor(gameTitleId: GameTitleId, snapshot: State): SeriesAnalysisStatus =
    SeriesAnalysisStatus(
      gameTitleId,
      SeriesAnalysisDesiredVersion(
        0,
        "series-analysis-v5",
        SeriesAnalysisArtifactContract.ArtifactSchemaVersion
      ),
      "unavailable",
      None,
      snapshot.jobs.get(gameTitleId).map(job =>
        SeriesAnalysisCalculation(
          job.status,
          job.trigger,
          job.requestedAt,
          job.startedAt,
          job.finishedAt
        )
      ),
    )

  private def newJob(
      id: String,
      title: GameTitle,
      requestedBy: AccountId,
      acceptedAt: Instant,
  ): SeriesAnalysisJobSummary = SeriesAnalysisJobSummary(
    jobId = id,
    gameTitleId = title.id,
    gameTitleName = title.name,
    status = "queued",
    trigger = "manual",
    coalescedTriggers = List("manual"),
    requestedBy = "administrator",
    manualRequestCount = 1,
    requestedAt = acceptedAt,
    startedAt = None,
    finishedAt = None,
    elapsedMilliseconds = None,
    inputRevision = 0,
    algorithmVersion = "series-analysis-v5",
    attemptCount = 0,
    transientRetryCount = 0,
    leaseRecoveryCount = 0,
    queueWaitMilliseconds = None,
    resultDisposition = "none",
    firstManualRequester = Some(SeriesAnalysisRequester(requestedBy, "administrator")),
    safeFailureCode = None,
  )

object InMemorySeriesAnalysisRepository:
  private final case class OperationKey(accountId: AccountId, endpoint: String, keyHash: String)
      derives CanEqual
  private final case class State(
      jobs: Map[GameTitleId, SeriesAnalysisJobSummary],
      recent: List[SeriesAnalysisJobSummary],
      operations: Map[OperationKey, SeriesAnalysisRecalculationAccepted],
      campaigns: Vector[SeriesAnalysisCampaignSummary],
  )

  private def replay(
      snapshot: State,
      key: OperationKey,
      gameTitleId: Option[GameTitleId],
  ): Option[Either[AppError, SeriesAnalysisRecalculationAccepted]] = snapshot.operations.get(key)
    .map { accepted =>
      if accepted.target.map(_.gameTitleId) == gameTitleId then accepted.asRight
      else
        AppError.IdempotencyPayloadMismatch(
          "Idempotency-Key was reused for a different game title."
        ).asLeft
    }

  def create[F[_]: Sync](
      gameTitles: GameTitlesRepository[F],
      now: F[Instant],
  ): F[InMemorySeriesAnalysisRepository[F]] =
    Ref.of[F, State](State(Map.empty, Nil, Map.empty, Vector.empty))
      .map(new InMemorySeriesAnalysisRepository(gameTitles, now, _))
