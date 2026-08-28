package momo.api.bootstrap

import cats.effect.Async
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.config.AppConfig
import momo.api.http.HttpRoutes
import momo.api.usecases.admin.*
import momo.api.usecases.exports.*
import momo.api.usecases.heldevents.*
import momo.api.usecases.images.*
import momo.api.usecases.masters.*
import momo.api.usecases.matchdrafts.*
import momo.api.usecases.matches.*
import momo.api.usecases.ocr.*
import momo.api.usecases.seriesanalysis.*

private[bootstrap] final case class UseCaseRouteBundles[F[_]](
    upload: HttpRoutes.UploadUseCases[F],
    ocr: HttpRoutes.OcrUseCases[F],
    heldEvents: HttpRoutes.HeldEventUseCases[F],
    matchDrafts: HttpRoutes.MatchDraftUseCases[F],
    matches: HttpRoutes.MatchUseCases[F],
    exportMatches: ExportMatches[F],
    analytics: HttpRoutes.AnalyticsUseCases[F],
    masters: HttpRoutes.MasterUseCases[F],
    adminAccounts: HttpRoutes.AdminAccountUseCases[F],
)

private[bootstrap] object UseCaseRouteBundles:
  def from[F[_]: Async: LoggerFactory](
      config: AppConfig,
      storage: UseCaseWiring.RuntimeStorage[F],
      repositories: UseCaseWiring.RuntimeRepositories[F],
      services: UseCaseWiring.RuntimeServices[F],
      now: F[java.time.Instant],
      ids: UseCaseWiring.RuntimeIds[F],
  ): UseCaseRouteBundles[F] =
    val imageStorage = storage.imageStorage
    val imageStorageAdmission = storage.imageStorageAdmission
    val ocrJobCreationStore = repositories.ocrJobCreationStore
    val jobs = repositories.jobs
    val drafts = repositories.drafts
    val heldEvents = repositories.heldEvents
    val heldEventDeletion = repositories.heldEventDeletion
    val matches = repositories.matches
    val matchNotes = repositories.matchNotes
    val matchExports = repositories.matchExports
    val matchDrafts = repositories.matchDrafts
    val matchDraftCancellation = repositories.matchDraftCancellation
    val matchList = repositories.matchList
    val seriesAnalysis = repositories.seriesAnalysis
    val matchConfirmation = repositories.matchConfirmation
    val members = repositories.members
    val loginAccounts = repositories.loginAccounts
    val loginAccountAdministration = repositories.loginAccountAdministration
    val gameTitles = repositories.gameTitles
    val mapMasters = repositories.mapMasters
    val seasonMasters = repositories.seasonMasters
    val incidentMasters = repositories.incidentMasters
    val memberAliases = repositories.memberAliases
    val ocrQueueSubmitter = services.ocrQueueSubmitter
    val ocrAdmissionGuard = services.ocrAdmissionGuard
    val uploadImage = UploadImage[F](imageStorage, imageStorageAdmission)
    val createOcrJob = CreateOcrJob[F](
      imageStore = imageStorage,
      creationStore = ocrJobCreationStore,
      matchDrafts = matchDrafts,
      queueSubmitter = ocrQueueSubmitter,
      admissionGuard = ocrAdmissionGuard,
      now = now,
      nextJobId = ids.nextOcrJobId,
      nextDraftId = ids.nextOcrDraftId,
      memberAliases = memberAliases,
      activeJobLimit = config.resourceLimits.ocrActiveJobLimit,
    )
    val getOcrJob = GetOcrJob[F](jobs)
    val getOcrDraft = GetOcrDraft[F](drafts)
    val getOcrDraftsBulk = GetOcrDraftsBulk[F](drafts)
    val cancelOcrJob = CancelOcrJob[F](jobs, now)
    val listHeldEvents = ListHeldEvents[F](heldEvents, matches, matchDrafts)
    val getHeldEventDetail = GetHeldEventDetail[F](heldEvents, matches, matchList)
    val createHeldEvent = CreateHeldEvent[F](heldEvents, ids.nextHeldEventId)
    val sourceImageRetention = PurgeSourceImages[F](matchDrafts, imageStorage)
    val createMatchDraft = CreateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = now,
      nextId = ids.nextMatchDraftId,
    )
    val getMatchDraft = GetMatchDraft[F](matchDrafts)
    val updateMatchDraft = UpdateMatchDraft[F](
      heldEvents = heldEvents,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      matchDrafts = matchDrafts,
      now = now,
    )
    val cancelMatchDraft =
      CancelMatchDraft[F](matchDraftCancellation, sourceImageRetention, now)
    val getMatchDraftSourceImages = GetMatchDraftSourceImages[F](
      matchDrafts,
      imageStorage,
      config.resourceLimits.sourceImageArchiveMaxBytes,
    )
    val confirmMatch = ConfirmMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      matchDrafts = matchDrafts,
      confirmations = matchConfirmation,
      sourceImageRetention = sourceImageRetention,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = now,
      nextId = ids.nextMatchId,
      allowedMemberIds = members.list.map(_.map(_.id).toSet),
    )
    val listMatches = ListMatches[F](matchList)
    val getSeriesAnalysisOptions = GetSeriesAnalysisOptions[F](seriesAnalysis)
    val getSeriesAnalysisStatus = GetSeriesAnalysisStatus[F](seriesAnalysis)
    val getSeriesAnalysisChunk = GetSeriesAnalysisChunk[F](seriesAnalysis)
    val getSeriesAnalysisAdminOverview = GetSeriesAnalysisAdminOverview[F](seriesAnalysis)
    val requestSeriesAnalysisRecalculation = RequestSeriesAnalysisRecalculation[F](seriesAnalysis)
    val exportMatches = ExportMatches[F](
      matchExports,
      members,
      mapMasters,
      seasonMasters,
      UseCaseWiring.exportMatchLimits(config.resourceLimits),
    )
    val getMatch = GetMatch[F](matches, loginAccounts)
    val replaceMatchNote = ReplaceMatchNote[F](matchNotes, now)
    val updateMatch = UpdateMatch[F](
      heldEvents = heldEvents,
      matches = matches,
      gameTitles = gameTitles,
      mapMasters = mapMasters,
      seasonMasters = seasonMasters,
      now = now,
      allowedMemberIds = members.list.map(_.map(_.id).toSet),
    )
    val deleteMatch = DeleteMatch[F](matches)
    val deleteHeldEvent = DeleteHeldEvent[F](heldEventDeletion)
    val listGameTitles = ListGameTitles[F](gameTitles)
    val listMapMasters = ListMapMasters[F](mapMasters)
    val listSeasonMasters = ListSeasonMasters[F](seasonMasters)
    val listIncidentMasters = ListIncidentMasters[F](incidentMasters)
    val createGameTitle = CreateGameTitle[F](gameTitles, now)
    val createMapMaster = CreateMapMaster[F](gameTitles, mapMasters, now)
    val createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasonMasters, now)
    val updateGameTitle = UpdateGameTitle[F](gameTitles)
    val updateMapMaster = UpdateMapMaster[F](mapMasters)
    val updateSeasonMaster = UpdateSeasonMaster[F](seasonMasters)
    val deleteGameTitle = DeleteGameTitle[F](gameTitles)
    val deleteMapMaster = DeleteMapMaster[F](mapMasters)
    val deleteSeasonMaster = DeleteSeasonMaster[F](seasonMasters)
    val listMemberAliases = ListMemberAliases[F](memberAliases)
    val createMemberAlias =
      CreateMemberAlias[F](memberAliases, members, now, ids.nextMemberAliasId)
    val updateMemberAlias = UpdateMemberAlias[F](memberAliases, members)
    val deleteMemberAlias = DeleteMemberAlias[F](memberAliases)
    val listLoginAccounts = ListLoginAccounts[F](loginAccounts)
    val createLoginAccount =
      CreateLoginAccount[F](loginAccounts, members, now, ids.nextLoginAccountId)
    val updateLoginAccount = UpdateLoginAccount[F](loginAccountAdministration, members, now)

    UseCaseRouteBundles(
      upload = HttpRoutes.UploadUseCases(uploadImage),
      ocr = HttpRoutes.OcrUseCases(
        createOcrJob = createOcrJob,
        getOcrJob = getOcrJob,
        getOcrDraft = getOcrDraft,
        getOcrDraftsBulk = getOcrDraftsBulk,
        cancelOcrJob = cancelOcrJob,
      ),
      heldEvents = HttpRoutes.HeldEventUseCases(
        listHeldEvents = listHeldEvents,
        getHeldEventDetail = getHeldEventDetail,
        createHeldEvent = createHeldEvent,
        deleteHeldEvent = deleteHeldEvent,
      ),
      matchDrafts = HttpRoutes.MatchDraftUseCases(
        createMatchDraft = createMatchDraft,
        getMatchDraft = getMatchDraft,
        updateMatchDraft = updateMatchDraft,
        cancelMatchDraft = cancelMatchDraft,
        getMatchDraftSourceImages = getMatchDraftSourceImages,
      ),
      matches = HttpRoutes.MatchUseCases(
        confirmMatch = confirmMatch,
        listMatches = listMatches,
        getMatch = getMatch,
        updateMatch = updateMatch,
        replaceMatchNote = replaceMatchNote,
        deleteMatch = deleteMatch,
      ),
      exportMatches = exportMatches,
      analytics = HttpRoutes.AnalyticsUseCases(
        getSeriesAnalysisOptions = getSeriesAnalysisOptions,
        getSeriesAnalysisStatus = getSeriesAnalysisStatus,
        getSeriesAnalysisChunk = getSeriesAnalysisChunk,
        getSeriesAnalysisAdminOverview = getSeriesAnalysisAdminOverview,
        requestSeriesAnalysisRecalculation = requestSeriesAnalysisRecalculation,
      ),
      masters = HttpRoutes.MasterUseCases(
        listGameTitles = listGameTitles,
        listMapMasters = listMapMasters,
        listSeasonMasters = listSeasonMasters,
        listIncidentMasters = listIncidentMasters,
        createGameTitle = createGameTitle,
        createMapMaster = createMapMaster,
        createSeasonMaster = createSeasonMaster,
        updateGameTitle = updateGameTitle,
        updateMapMaster = updateMapMaster,
        updateSeasonMaster = updateSeasonMaster,
        deleteGameTitle = deleteGameTitle,
        deleteMapMaster = deleteMapMaster,
        deleteSeasonMaster = deleteSeasonMaster,
        listMemberAliases = listMemberAliases,
        createMemberAlias = createMemberAlias,
        updateMemberAlias = updateMemberAlias,
        deleteMemberAlias = deleteMemberAlias,
      ),
      adminAccounts = HttpRoutes.AdminAccountUseCases(
        listLoginAccounts = listLoginAccounts,
        createLoginAccount = createLoginAccount,
        updateLoginAccount = updateLoginAccount,
      ),
    )
