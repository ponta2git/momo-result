package momo.api.bootstrap

import java.time.Instant

import cats.Monad
import cats.effect.Async
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.http.modules.{HeldEventModule, MatchDraftModule, MatchModule}
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.*
import momo.api.usecases.heldevents.*
import momo.api.usecases.matchdrafts.*
import momo.api.usecases.matches.*

private[bootstrap] object MatchUseCaseWiring:
  def heldEvents[F[_]: Monad](
      events: HeldEventsRepository[F],
      details: HeldEventDetailReadModel[F],
      list: HeldEventListReadModel[F],
      deletion: HeldEventDeletionRepository[F],
      nextId: F[HeldEventId],
  ): HeldEventModule.UseCases[F] = HeldEventModule.UseCases(
    listHeldEvents = ListHeldEvents[F](list),
    getHeldEventDetail = GetHeldEventDetail[F](details),
    createHeldEvent = CreateHeldEvent[F](events, nextId),
    deleteHeldEvent = DeleteHeldEvent[F](deletion),
  )

  def drafts[F[_]: Async](
      events: HeldEventsRepository[F],
      gameTitles: GameTitlesRepository[F],
      maps: MapMastersRepository[F],
      seasons: SeasonMastersRepository[F],
      drafts: MatchDraftsRepository[F],
      reviews: MatchDraftReviewReadModel[F],
      cancellation: MatchDraftCancellationRepository[F],
      images: ImageStorage[F],
      retention: PurgeSourceImages[F],
      archiveMaxBytes: Long,
      now: F[Instant],
      nextId: F[MatchDraftId],
  ): MatchDraftModule.UseCases[F] = MatchDraftModule.UseCases(
    createMatchDraft = CreateMatchDraft[F](events, gameTitles, maps, seasons, drafts, now, nextId),
    getMatchDraft = GetMatchDraft[F](drafts),
    getMatchDraftReview = GetMatchDraftReview[F](reviews),
    updateMatchDraft = UpdateMatchDraft[F](events, gameTitles, maps, seasons, drafts, now),
    cancelMatchDraft = CancelMatchDraft[F](cancellation, retention, now),
    getMatchDraftSourceImages = GetMatchDraftSourceImages[F](drafts, images, archiveMaxBytes),
  )

  def matches[F[_]: Monad](
      events: HeldEventsRepository[F],
      matches: MatchesRepository[F],
      details: MatchDetailReadModel[F],
      list: MatchListReadModel[F],
      notes: MatchNotesRepository[F],
      drafts: MatchDraftsRepository[F],
      confirmations: MatchConfirmationRepository[F],
      retention: PurgeSourceImages[F],
      gameTitles: GameTitlesRepository[F],
      maps: MapMastersRepository[F],
      seasons: SeasonMastersRepository[F],
      members: MembersRepository[F],
      now: F[Instant],
      nextId: F[MatchId],
  ): MatchModule.UseCases[F] =
    val allowedMemberIds = members.list.map(_.map(_.id).toSet)
    MatchModule.UseCases(
      confirmMatch = ConfirmMatch[F](
        heldEvents = events,
        matches = matches,
        matchDrafts = drafts,
        confirmations = confirmations,
        sourceImageRetention = retention,
        gameTitles = gameTitles,
        mapMasters = maps,
        seasonMasters = seasons,
        now = now,
        nextId = nextId,
        allowedMemberIds = allowedMemberIds,
      ),
      listMatches = ListMatches[F](list),
      getMatch = GetMatch[F](details),
      updateMatch = UpdateMatch[F](events, matches, gameTitles, maps, seasons, now, allowedMemberIds),
      replaceMatchNote = ReplaceMatchNote[F](notes, now),
      deleteMatch = DeleteMatch[F](matches),
    )
