package momo.api.http

import cats.effect.{Async, Clock, Resource}
import cats.syntax.all.*
import momo.api.adapters.{
  InMemoryAppSessionsRepository, InMemoryGameTitlesRepository, InMemoryHeldEventsRepository,
  InMemoryIncidentMastersRepository, InMemoryMapMastersRepository,
  InMemoryMatchConfirmationRepository, InMemoryMatchDraftsRepository, InMemoryMatchListRepository,
  InMemoryMatchesRepository, InMemoryMembersRepository, InMemoryOcrDraftsRepository,
  InMemoryOcrJobsRepository, InMemoryQueueProducer, InMemorySeasonMastersRepository,
  LocalFsImageStore, RedisQueueProducer,
}
import momo.api.auth.{
  CsrfTokenService, JavaDiscordOAuthClient, LoginRateLimiter, MemberRoster, OAuthStateCodec,
  SessionService,
}
import momo.api.config.AppConfig
import momo.api.db.Database
import momo.api.domain.{IdGenerator, Member}
import momo.api.repositories.{
  AppSessionsRepository, GameTitlesRepository, HeldEventsRepository, IncidentMastersRepository,
  MapMastersRepository, MatchConfirmationRepository, MatchDraftsRepository, MatchListRepository,
  MatchesRepository, MembersRepository, OcrDraftsRepository, OcrJobsRepository,
  SeasonMastersRepository,
}
import momo.api.repositories.postgres.{
  PostgresAppSessionsRepository, PostgresGameTitlesRepository, PostgresHeldEventsRepository,
  PostgresIncidentMastersRepository, PostgresMapMastersRepository,
  PostgresMatchConfirmationRepository, PostgresMatchDraftsRepository, PostgresMatchListRepository,
  PostgresMatchesRepository, PostgresMembersRepository, PostgresOcrDraftsRepository,
  PostgresOcrJobsRepository, PostgresSeasonMastersRepository,
}
import momo.api.usecases.{
  CancelMatchDraft, CancelOcrJob, ConfirmMatch, CreateGameTitle, CreateHeldEvent, CreateMapMaster,
  CreateMatchDraft, CreateOcrJob, CreateSeasonMaster, DeleteMatch, ExportMatches, GetMatch,
  GetMatchDraftSourceImages, GetOcrDraft, GetOcrDraftsBulk, GetOcrJob, ListHeldEvents, ListMatches,
  SourceImageRetentionService, UpdateMatch, UpdateMatchDraft, UploadImage,
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
    case Some(db) => Resource.eval(Async[F].executionContext).flatMap { connectExecutionContext =>
        (Database.transactor[F](db, connectExecutionContext), queueResource[F](config)).tupled
          .evalMap { (transactor, queue) =>
            val jobs: OcrJobsRepository[F] = PostgresOcrJobsRepository[F](transactor)
            val drafts: OcrDraftsRepository[F] = PostgresOcrDraftsRepository[F](transactor)
            val heldEvents: HeldEventsRepository[F] = PostgresHeldEventsRepository[F](transactor)
            val matches: MatchesRepository[F] = PostgresMatchesRepository[F](transactor)
            val matchDrafts: MatchDraftsRepository[F] = PostgresMatchDraftsRepository[F](transactor)
            val matchList: MatchListRepository[F] = PostgresMatchListRepository[F](transactor)
            val matchConfirmation: MatchConfirmationRepository[F] =
              PostgresMatchConfirmationRepository[F](transactor)
            val appSessions: AppSessionsRepository[F] = PostgresAppSessionsRepository[F](transactor)
            val members: MembersRepository[F] = PostgresMembersRepository[F](transactor)
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
              matchDrafts = matchDrafts,
              matchList = matchList,
              matchConfirmation = matchConfirmation,
              appSessions = appSessions,
              members = members,
              gameTitles = gameTitles,
              mapMasters = mapMasters,
              seasonMasters = seasonMasters,
              incidentMasters = incidentMasters,
            )
          }
      }
    case None => queueResource[F](config).evalMap { queue =>
        for
          jobs <- InMemoryOcrJobsRepository.create[F]
          drafts <- InMemoryOcrDraftsRepository.create[F]
          heldEvents <- InMemoryHeldEventsRepository.create[F]
          matches <- InMemoryMatchesRepository.create[F]
          matchDrafts <- InMemoryMatchDraftsRepository.create[F]
          matchList = InMemoryMatchListRepository[F](matches, matchDrafts)
          matchConfirmation = InMemoryMatchConfirmationRepository[F](matches, matchDrafts)
          appSessions <- InMemoryAppSessionsRepository.create[F]
          members <- InMemoryMembersRepository
            .create[F](config.devMemberIds.map(id => Member(id, id, id, java.time.Instant.EPOCH)))
          gameTitles <- InMemoryGameTitlesRepository.create[F]
          mapMasters <- InMemoryMapMastersRepository.create[F]
          seasonMasters <- InMemorySeasonMastersRepository.create[F]
          incidentMasters <- InMemoryIncidentMastersRepository.create[F]
          wired <- assemble(
            config = config,
            queue = queue,
            jobs = jobs,
            drafts = drafts,
            heldEvents = heldEvents,
            matches = matches,
            matchDrafts = matchDrafts,
            matchList = matchList,
            matchConfirmation = matchConfirmation,
            appSessions = appSessions,
            members = members,
            gameTitles = gameTitles,
            mapMasters = mapMasters,
            seasonMasters = seasonMasters,
            incidentMasters = incidentMasters,
          )
        yield wired
      }

  private def queueResource[F[_]: Async](
      config: AppConfig
  ): Resource[F, momo.api.repositories.QueueProducer[F]] = config.redis match
    case Some(redis) => RedisQueueProducer.resource[F](redis).widen
    case None => Resource.eval(InMemoryQueueProducer.create[F]).widen

  private def assemble[F[_]: Async](
      config: AppConfig,
      queue: momo.api.repositories.QueueProducer[F],
      jobs: OcrJobsRepository[F],
      drafts: OcrDraftsRepository[F],
      heldEvents: HeldEventsRepository[F],
      matches: MatchesRepository[F],
      matchDrafts: MatchDraftsRepository[F],
      matchList: MatchListRepository[F],
      matchConfirmation: MatchConfirmationRepository[F],
      appSessions: AppSessionsRepository[F],
      members: MembersRepository[F],
      gameTitles: GameTitlesRepository[F],
      mapMasters: MapMastersRepository[F],
      seasonMasters: SeasonMastersRepository[F],
      incidentMasters: IncidentMastersRepository[F],
  ): F[Wired[F]] =
    val imageStore = LocalFsImageStore[F](config.imageTmpDir)
    val roster = MemberRoster.dev(config.devMemberIds)
    val uploadImage = UploadImage[F](imageStore)
    val nowF = Clock[F].realTimeInstant
    val sessionService = SessionService[F](appSessions, members, config.auth, nowF)
    val csrfTokenService = CsrfTokenService()
    val oauthStateCodec = OAuthStateCodec[F](config.auth, nowF)
    val oauthClient = JavaDiscordOAuthClient[F](config.auth)
    val createOcrJob = CreateOcrJob[F](
      imageStore = imageStore,
      jobs = jobs,
      drafts = drafts,
      matchDrafts = matchDrafts,
      queue = queue,
      now = nowF,
      nextId = IdGenerator.next[F],
      requestIdLookup = RequestIdMiddleware.lookup[F],
    )
    val getOcrJob = GetOcrJob[F](jobs)
    val getOcrDraft = GetOcrDraft[F](drafts)
    val getOcrDraftsBulk = GetOcrDraftsBulk[F](drafts)
    val cancelOcrJob = CancelOcrJob[F](jobs, nowF)
    val listHeldEvents = ListHeldEvents[F](heldEvents, matches)
    val createHeldEvent = CreateHeldEvent[F](heldEvents, IdGenerator.next[F])
    val sourceImageRetention = SourceImageRetentionService[F](matchDrafts)
    val createMatchDraft = CreateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = nowF,
      nextId = IdGenerator.next[F],
    )
    val updateMatchDraft = UpdateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = nowF,
    )
    val cancelMatchDraft = CancelMatchDraft[F](matchDrafts, sourceImageRetention, nowF)
    val getMatchDraftSourceImages = GetMatchDraftSourceImages[F](matchDrafts, imageStore)
    val confirmMatch = ConfirmMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      matchDrafts = matchDrafts,
      confirmations = matchConfirmation,
      sourceImageRetention = sourceImageRetention,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = nowF,
      nextId = IdGenerator.next[F],
      allowedMemberIds = config.devMemberIds.toSet,
    )
    val listMatches = ListMatches[F](matchList)
    val exportMatches = ExportMatches[F](matches, members, mapMasters, seasonMasters)
    val getMatch = GetMatch[F](matches)
    val updateMatch = UpdateMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = nowF,
      allowedMemberIds = config.devMemberIds.toSet,
    )
    val deleteMatch = DeleteMatch[F](matches)
    val createGameTitle = CreateGameTitle[F](gameTitles, nowF)
    val createMapMaster = CreateMapMaster[F](gameTitles, mapMasters, nowF)
    val createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasonMasters, nowF)

    LoginRateLimiter.create[F](config.auth.rateLimitPerMinute, nowF).map { loginRateLimiter =>
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
        createMatchDraft = createMatchDraft,
        updateMatchDraft = updateMatchDraft,
        cancelMatchDraft = cancelMatchDraft,
        getMatchDraftSourceImages = getMatchDraftSourceImages,
        confirmMatch = confirmMatch,
        exportMatches = exportMatches,
        listMatches = listMatches,
        getMatch = getMatch,
        updateMatch = updateMatch,
        deleteMatch = deleteMatch,
        gameTitles = gameTitles,
        mapMasters = mapMasters,
        seasonMasters = seasonMasters,
        incidentMasters = incidentMasters,
        createGameTitle = createGameTitle,
        createMapMaster = createMapMaster,
        createSeasonMaster = createSeasonMaster,
        members = members,
        oauthClient = oauthClient,
        sessionService = sessionService,
        csrfTokenService = csrfTokenService,
        oauthStateCodec = oauthStateCodec,
        loginRateLimiter = loginRateLimiter,
      ))
      Wired(app, gameTitles, mapMasters, seasonMasters)
    }
