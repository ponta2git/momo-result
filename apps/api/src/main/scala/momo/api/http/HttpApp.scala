package momo.api.http

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import java.time.Instant
import momo.api.adapters.{
  InMemoryGameTitlesRepository, InMemoryHeldEventsRepository, InMemoryIncidentMastersRepository,
  InMemoryMapMastersRepository, InMemoryMatchesRepository, InMemoryOcrDraftsRepository,
  InMemoryOcrJobsRepository, InMemoryQueueProducer, InMemorySeasonMastersRepository,
  LocalFsImageStore,
}
import momo.api.auth.MemberRoster
import momo.api.config.AppConfig
import momo.api.db.Database
import momo.api.domain.IdGenerator
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, IncidentMastersRepository, MapMastersRepository,
  MatchesRepository, OcrDraftsRepository, OcrJobsRepository, SeasonMastersRepository,
}
import momo.api.repositories.postgres.{
  PostgresGameTitlesRepository, PostgresHeldEventsRepository, PostgresIncidentMastersRepository,
  PostgresMapMastersRepository, PostgresMatchesRepository, PostgresOcrDraftsRepository,
  PostgresOcrJobsRepository, PostgresSeasonMastersRepository,
}
import momo.api.usecases.{
  CancelOcrJob, ConfirmMatch, CreateGameTitle, CreateHeldEvent, CreateMapMaster, CreateOcrJob,
  CreateSeasonMaster, GetOcrDraft, GetOcrDraftsBulk, GetOcrJob, ListHeldEvents, UploadImage,
}
import org.http4s.HttpApp as Http4sApp

object HttpApp:
  /** Test-only handle for specs that need direct access to in-memory master repositories. */
  final case class Wired[F[_]](
      app: Http4sApp[F],
      gameTitles: momo.api.repositories.GameTitlesRepository[F],
      mapMasters: momo.api.repositories.MapMastersRepository[F],
      seasonMasters: momo.api.repositories.SeasonMastersRepository[F],
  )

  def resource[F[_]: Async](config: AppConfig): Resource[F, Http4sApp[F]] = wired[F](config)
    .map(_.app)

  /**
   * Build all dependencies. When `config.database` is set we use PostgreSQL repositories backed by
   * HikariCP; otherwise we wire up InMemory adapters (used by tests and the early dev environment).
   */
  def wired[F[_]: Async](config: AppConfig): Resource[F, Wired[F]] = config.database match
    case Some(db) => Database.transactor[F](db).evalMap { transactor =>
        for queue <- InMemoryQueueProducer.create[F] yield
          val jobs: OcrJobsRepository[F] = PostgresOcrJobsRepository[F](transactor)
          val drafts: OcrDraftsRepository[F] = PostgresOcrDraftsRepository[F](transactor)
          val heldEvents: HeldEventsRepository[F] = PostgresHeldEventsRepository[F](transactor)
          val matches: MatchesRepository[F] = PostgresMatchesRepository[F](transactor)
          val gameTitles: GameTitlesRepository[F] = PostgresGameTitlesRepository[F](transactor)
          val mapMasters: MapMastersRepository[F] = PostgresMapMastersRepository[F](transactor)
          val seasonMasters: SeasonMastersRepository[F] =
            PostgresSeasonMastersRepository[F](transactor)
          val incidentMasters: IncidentMastersRepository[F] =
            PostgresIncidentMastersRepository[F](transactor)
          assemble(
            config = config,
            queue = queue,
            jobs = jobs,
            drafts = drafts,
            heldEvents = heldEvents,
            matches = matches,
            gameTitles = gameTitles,
            mapMasters = mapMasters,
            seasonMasters = seasonMasters,
            incidentMasters = incidentMasters,
          )
      }
    case None => Resource.eval {
        for
          jobs <- InMemoryOcrJobsRepository.create[F]
          drafts <- InMemoryOcrDraftsRepository.create[F]
          queue <- InMemoryQueueProducer.create[F]
          heldEvents <- InMemoryHeldEventsRepository.create[F]
          matches <- InMemoryMatchesRepository.create[F]
          gameTitles <- InMemoryGameTitlesRepository.create[F]
          mapMasters <- InMemoryMapMastersRepository.create[F]
          seasonMasters <- InMemorySeasonMastersRepository.create[F]
          incidentMasters <- InMemoryIncidentMastersRepository.create[F]
        yield assemble(
          config = config,
          queue = queue,
          jobs = jobs,
          drafts = drafts,
          heldEvents = heldEvents,
          matches = matches,
          gameTitles = gameTitles,
          mapMasters = mapMasters,
          seasonMasters = seasonMasters,
          incidentMasters = incidentMasters,
        )
      }

  private def assemble[F[_]: Async](
      config: AppConfig,
      queue: momo.api.repositories.QueueProducer[F],
      jobs: OcrJobsRepository[F],
      drafts: OcrDraftsRepository[F],
      heldEvents: HeldEventsRepository[F],
      matches: MatchesRepository[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
  ): Wired[F] =
    val imageStore = LocalFsImageStore[F](config.imageTmpDir)
    val roster = MemberRoster.dev(config.devMemberIds)
    val uploadImage = UploadImage[F](imageStore)
    val nowF = Async[F].delay(Instant.now())
    val createOcrJob = CreateOcrJob[F](
      imageStore = imageStore,
      jobs = jobs,
      drafts = drafts,
      queue = queue,
      now = nowF,
      nextId = IdGenerator.next[F],
    )
    val getOcrJob = GetOcrJob[F](jobs)
    val getOcrDraft = GetOcrDraft[F](drafts)
    val getOcrDraftsBulk = GetOcrDraftsBulk[F](drafts)
    val cancelOcrJob = CancelOcrJob[F](jobs, nowF)
    val listHeldEvents = ListHeldEvents[F](heldEvents, matches)
    val createHeldEvent = CreateHeldEvent[F](heldEvents, IdGenerator.next[F])
    val confirmMatch = ConfirmMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = nowF,
      nextId = IdGenerator.next[F],
      allowedMemberIds = config.devMemberIds.toSet,
    )
    val createGameTitle = CreateGameTitle[F](gameTitles, nowF)
    val createMapMaster = CreateMapMaster[F](gameTitles, mapMasters, nowF)
    val createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasonMasters, nowF)

    val app = HttpRoutes.routes(HttpRoutes.Dependencies(
      config = config,
      roster = roster,
      uploadImage = uploadImage,
      createOcrJob = createOcrJob,
      getOcrJob = getOcrJob,
      getOcrDraft = getOcrDraft,
      getOcrDraftsBulk = getOcrDraftsBulk,
      cancelOcrJob = cancelOcrJob,
      listHeldEvents = listHeldEvents,
      createHeldEvent = createHeldEvent,
      confirmMatch = confirmMatch,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      incidentMasters = incidentMasters,
      createGameTitle = createGameTitle,
      createMapMaster = createMapMaster,
      createSeasonMaster = createSeasonMaster,
    ))
    Wired(app, gameTitles, mapMasters, seasonMasters)
