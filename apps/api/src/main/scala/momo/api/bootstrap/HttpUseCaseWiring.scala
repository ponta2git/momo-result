package momo.api.bootstrap

import cats.effect.Async
import org.typelevel.log4cats.LoggerFactory

import momo.api.config.AppConfig
import momo.api.http.HttpRoutes
import momo.api.repositories.EntityReferenceResolver
import momo.api.usecases.exports.ExportMatches
import momo.api.usecases.ocr.OcrSubmissions

private[bootstrap] object HttpUseCaseWiring:
  def from[F[_]: Async: LoggerFactory](
      config: AppConfig,
      storage: UseCaseWiring.RuntimeStorage[F],
      repositories: UseCaseWiring.RuntimeRepositories[F],
      services: UseCaseWiring.RuntimeServices[F],
      now: F[java.time.Instant],
      ids: UseCaseWiring.RuntimeIds[F],
  ): HttpRoutes.UseCases[F] =
    import repositories.*
    import storage.*

    val references = identityReferences.getOrElse(EntityReferenceResolver.preserve[F])
    val submissions = OcrSubmissions[F](ocrSubmissions, now, Some(references))
    HttpRoutes.UseCases(
      upload = OcrUseCaseWiring.upload(imageStorage, imageStorageAdmission, submissions),
      ocr = OcrUseCaseWiring.jobs(
        images = imageStorage,
        creation = ocrJobCreationStore,
        submissionRepository = ocrSubmissions,
        submissions = submissions,
        jobs = jobs,
        drafts = drafts,
        matchDrafts = matchDrafts,
        aliases = memberAliases,
        admission = services.ocrAdmissionGuard,
        activeJobLimit = config.resourceLimits.ocrActiveJobLimit,
        now = now,
        nextJobId = ids.nextOcrJobId,
        nextDraftId = ids.nextOcrDraftId,
      ),
      heldEvents = MatchUseCaseWiring.heldEvents(
        events = heldEvents,
        details = heldEventDetails,
        list = heldEventList,
        deletion = heldEventDeletion,
        nextId = ids.nextHeldEventId,
      ),
      matchDrafts = MatchUseCaseWiring.drafts(
        events = heldEvents,
        gameTitles = gameTitles,
        maps = mapMasters,
        seasons = seasonMasters,
        drafts = matchDrafts,
        reviews = matchDraftReviews,
        cancellation = matchDraftCancellation,
        images = imageStorage,
        archiveMaxBytes = config.resourceLimits.sourceImageArchiveMaxBytes,
        now = now,
        nextId = ids.nextMatchDraftId,
        references = references,
      ),
      matches = MatchUseCaseWiring.matches(
        events = heldEvents,
        matches = matches,
        details = matchDetails,
        list = matchList,
        notes = matchNotes,
        drafts = matchDrafts,
        confirmations = matchConfirmation,
        gameTitles = gameTitles,
        maps = mapMasters,
        seasons = seasonMasters,
        members = members,
        now = now,
        nextId = ids.nextMatchId,
        references = references,
      ),
      exportMatches = ExportMatches[F](
        matchExports,
        UseCaseWiring.exportMatchLimits(config.resourceLimits),
      ),
      seriesAnalysis = AnalysisUseCaseWiring.analysis(seriesAnalysis),
      achievements = new momo.api.usecases.achievements.ManageAchievements[F](achievements, now),
      seriesPlayerRadar = AnalysisUseCaseWiring.radar(seriesPlayerRadar),
      masters = MasterUseCaseWiring(
        gameTitles = gameTitles,
        maps = mapMasters,
        seasons = seasonMasters,
        incidents = incidentMasters,
        aliases = memberAliases,
        members = members,
        now = now,
        nextAliasId = ids.nextMemberAliasId,
      ),
      adminAccounts = AccountUseCaseWiring.accounts(
        accounts = loginAccounts,
        administration = loginAccountAdministration,
        members = members,
        now = now,
        nextId = ids.nextLoginAccountId,
      ),
      notificationSettings = AccountUseCaseWiring.notifications(notificationSettings, now),
    )
