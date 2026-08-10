package momo.api.adapters.inmemory

import java.time.Instant
import java.util.UUID

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.{GameTitlesRepository, SeriesAnalysisRepository}

final class InMemorySeriesAnalysisRepository[F[_]: Sync] private (
    gameTitles: GameTitlesRepository[F],
    now: F[Instant],
    calculations: Ref[F, Map[GameTitleId, SeriesAnalysisCalculation]],
    recent: Ref[F, List[SeriesAnalysisJobSummary]],
) extends SeriesAnalysisRepository[F]:
  override def options: F[Either[AppError, SeriesAnalysisOptions]] = gameTitles.list.map { titles =>
    val sorted = titles.sortBy(value => (value.displayOrder, value.id.value))
    SeriesAnalysisOptions(
      sorted.headOption.map(_.id),
      sorted.map(value =>
        SeriesAnalysisTitleOption(value.id, value.name, 0, Nil, Nil, Nil)
      ),
    ).asRight
  }

  override def status(
      gameTitleId: GameTitleId
  ): F[Either[AppError, SeriesAnalysisStatus]] = gameTitles.find(gameTitleId).flatMap {
    case None => AppError.NotFound("game title", gameTitleId.value).asLeft.pure[F]
    case Some(_) => calculations.get.map(values =>
        SeriesAnalysisStatus(
          gameTitleId,
          SeriesAnalysisDesiredVersion(0, "series-analysis-v1", 1),
          "unavailable",
          None,
          values.get(gameTitleId),
        ).asRight
      )
  }

  override def chunk(
      request: SeriesAnalysisChunkRequest
  ): F[Either[AppError, SeriesAnalysisChunk]] =
    AppError.AnalysisArtifactExpired().asLeft.pure[F]

  override def adminOverview(
      gameTitleId: Option[GameTitleId]
  ): F[Either[AppError, SeriesAnalysisAdminOverview]] =
    for
      optionsResult <- options
      calculationsValue <- calculations.get
      jobs <- recent.get
      result <- optionsResult match
        case Left(error) => error.asLeft[SeriesAnalysisAdminOverview].pure[F]
        case Right(value) =>
          val selectedId = gameTitleId.orElse(value.defaultGameTitleId)
          selectedId match
            case Some(id) if !value.titles.exists(_.gameTitleId == id) =>
              AppError.NotFound("game title", id.value).asLeft[SeriesAnalysisAdminOverview].pure[F]
            case _ =>
              val selected = selectedId.flatMap(id => value.titles.find(_.gameTitleId == id)
                .map(option => SeriesAnalysisSelectedTitle(
                  id,
                  option.displayName,
                  SeriesAnalysisStatus(
                    id,
                    SeriesAnalysisDesiredVersion(0, "series-analysis-v1", 1),
                    "unavailable",
                    None,
                    calculationsValue.get(id),
                  ),
                  None,
                )))
              SeriesAnalysisAdminOverview(
                value.titles,
                selected,
                SeriesAnalysisGlobalExecution(
                  runningCount = 0,
                  queuedTitleCount = calculationsValue.size,
                  oldestQueuedAt = calculationsValue.values.map(_.requestedAt).minOption,
                  activeCampaignCount = 0,
                  latestActiveCampaign = None,
                ),
                jobs.take(3),
              ).asRight[AppError].pure[F]
    yield result

  override def requestTitleRecalculation(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = gameTitles.find(gameTitleId)
    .flatMap {
      case None => AppError.NotFound("game title", gameTitleId.value).asLeft.pure[F]
      case Some(title) => enqueue(List(title), requestedBy, Some(gameTitleId)).map(_.asRight)
    }

  override def requestAllRecalculation(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = gameTitles.list.flatMap {
    case Nil => AppError.AnalysisNoEligibleTitles().asLeft.pure[F]
    case titles => enqueue(titles, requestedBy, None).map(value => value.copy(
        campaign = Some(SeriesAnalysisAcceptedCampaign(UUID.randomUUID().toString, "expanding"))
      ).asRight)
  }

  private def enqueue(
      titles: List[GameTitle],
      requestedBy: AccountId,
      targetTitleId: Option[GameTitleId],
  ): F[SeriesAnalysisRecalculationAccepted] =
    for
      acceptedAt <- now
      requestId <- Sync[F].delay(UUID.randomUUID().toString)
      enqueued <- titles.traverse(title => Sync[F].delay {
        val calculation = SeriesAnalysisCalculation("queued", "manual", acceptedAt, None, None)
        val job = SeriesAnalysisJobSummary(
          UUID.randomUUID().toString,
          title.id,
          title.name,
          "queued",
          "manual",
          List("manual"),
          "administrator",
          1,
          acceptedAt,
          None,
          None,
          None,
          0,
          "series-analysis-v1",
          0,
          0,
          0,
          None,
          "none",
          Some(SeriesAnalysisRequester(requestedBy, "administrator")),
          None,
        )
        title.id -> (calculation, job)
      })
      _ <- calculations.update(_ ++ enqueued.map { case (titleId, (calculation, _)) =>
          titleId -> calculation
        })
      _ <- recent.update(enqueued.map(_._2._2).reverse ::: _)
      target = targetTitleId.flatMap(titleId => enqueued.collectFirst {
        case (`titleId`, (_, job)) =>
          SeriesAnalysisAcceptedTarget(titleId, Some(job.jobId), "created_job")
      })
    yield SeriesAnalysisRecalculationAccepted(requestId, acceptedAt, titles.size, None, target)

object InMemorySeriesAnalysisRepository:
  def create[F[_]: Sync](
      gameTitles: GameTitlesRepository[F],
      now: F[Instant],
  ): F[InMemorySeriesAnalysisRepository[F]] =
    for
      calculations <- Ref.of[F, Map[GameTitleId, SeriesAnalysisCalculation]](Map.empty)
      recent <- Ref.of[F, List[SeriesAnalysisJobSummary]](Nil)
    yield new InMemorySeriesAnalysisRepository(gameTitles, now, calculations, recent)
