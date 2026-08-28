package momo.api.usecases.matches

import java.time.Instant

import cats.Monad
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  MatchNote,
  MatchNoteBody,
  MatchNoteVersion,
  MatchPolicy,
  MatchRecord,
  PlayerResult
}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository,
  HeldEventsRepository,
  MapMastersRepository,
  MatchConfirmationRepository,
  MatchConfirmationResult,
  MatchDraftConfirmation,
  MatchDraftsRepository,
  MatchesRepository,
  SeasonMastersRepository
}
import momo.api.usecases.common.MatchReferenceValidation
import momo.api.usecases.matchdrafts.PurgeSourceImages
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class MatchDraftRefs(
    totalAssets: Option[OcrDraftId],
    revenue: Option[OcrDraftId],
    incidentLog: Option[OcrDraftId],
)

final case class ConfirmMatchCommand(
    heldEventId: HeldEventId,
    matchNoInEvent: Int,
    gameTitleId: GameTitleId,
    seasonMasterId: SeasonMasterId,
    ownerMemberId: MemberId,
    mapMasterId: MapMasterId,
    playedAt: Instant,
    matchDraftId: Option[MatchDraftId],
    draftRefs: MatchDraftRefs,
    players: List[PlayerResult.Input],
    noteBody: Option[MatchNoteBody] = None,
)

final class ConfirmMatch[F[_]: Monad](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    confirmations: MatchConfirmationRepository[F],
    sourceImageRetention: PurgeSourceImages[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    now: F[Instant],
    nextId: F[MatchId],
    allowedMemberIds: F[Set[MemberId]],
):
  import ConfirmMatch.*

  private val referenceValidation =
    MatchReferenceValidation(heldEvents, gameTitles, mapMasters, seasonMasters)

  def run(
      command: ConfirmMatchCommand,
      createdBy: AccountId,
      playerMemberId: Option[MemberId],
  ): F[Either[AppError, MatchRecord]] = (for
    allowed <- EitherT.liftF(allowedMemberIds)
    validated <- EitherT.fromEither[F](
      MatchPolicy.validate(
        MatchPolicy.Input(
          heldEventId = command.heldEventId,
          matchNoInEvent = command.matchNoInEvent,
          gameTitleId = command.gameTitleId,
          seasonMasterId = command.seasonMasterId,
          ownerMemberId = command.ownerMemberId,
          mapMasterId = command.mapMasterId,
          players = command.players,
        ),
        allowed,
      ).leftMap(errors => AppError.ValidationFailed(MatchPolicy.toMessage(errors)))
    )
    title <- referenceValidation.validateRequired(
      command.heldEventId,
      command.gameTitleId,
      command.mapMasterId,
      command.seasonMasterId,
    )
    duplicate <- EitherT.liftF(matches.existsMatchNo(command.heldEventId, validated.matchNoInEvent))
    _ <- EitherT.fromEither[F](
      if duplicate then
        Left(AppError.Conflict(s"matchNoInEvent ${command
            .matchNoInEvent} already exists for held event ${command.heldEventId.value}."))
      else Right(())
    )
    id <- EitherT.liftF(nextId)
    createdAt <- EitherT.liftF(now)
    record = toMatchRecord(
      id,
      createdAt,
      command.playedAt,
      title.layoutFamily,
      createdBy,
      playerMemberId,
      command,
      validated,
    )
    maybeDraft <- command.matchDraftId match
      case None => EitherT.rightT[F, AppError](Option.empty[momo.api.domain.MatchDraft])
      case Some(draftId) => matchDrafts.find(draftId).orNotFound("match draft", draftId.value)
          .flatMap { draft =>
            EitherT.fromEither[F](validateDraftForConfirm(draft, command.draftRefs))
              .map(_ => Some(draft))
          }
    confirmation <- EitherT(
      confirmations.confirm(record, maybeDraft.map(MatchDraftConfirmation.from), createdAt)
    )
    _ <- EitherT.fromEither[F](
      confirmation match
        case MatchConfirmationResult.Confirmed => Right(())
        case MatchConfirmationResult.DraftSnapshotMismatch =>
          Left(AppError.Conflict("Failed to confirm match from the draft."))
    )
    _ <- maybeDraft match
      case None => EitherT.rightT[F, AppError](())
      case Some(draft) => EitherT.liftF(sourceImageRetention.runBestEffort(draft.id, createdAt))
  yield record).value

object ConfirmMatch:
  private def toMatchRecord(
      id: MatchId,
      createdAt: Instant,
      playedAt: Instant,
      layoutFamily: String,
      createdByAccountId: AccountId,
      createdByMemberId: Option[MemberId],
      command: ConfirmMatchCommand,
      validated: MatchRecord.ValidatedInput,
  ): MatchRecord = MatchRecord(
    id = id,
    heldEventId = validated.heldEventId,
    matchNoInEvent = validated.matchNoInEvent,
    gameTitleId = validated.gameTitleId,
    layoutFamily = layoutFamily,
    seasonMasterId = validated.seasonMasterId,
    ownerMemberId = validated.ownerMemberId,
    mapMasterId = validated.mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = command.draftRefs.totalAssets,
    revenueDraftId = command.draftRefs.revenue,
    incidentLogDraftId = command.draftRefs.incidentLog,
    players = validated.players,
    createdByAccountId = createdByAccountId,
    createdByMemberId = createdByMemberId,
    createdAt = createdAt,
    note = command.noteBody.fold(MatchNote.Empty)(body =>
      MatchNote(
        Some(body),
        MatchNoteVersion.Initial.next,
        Some(createdByAccountId),
        Some(createdAt)
      )
    ),
  )

  private def validateDraftForConfirm(
      draft: momo.api.domain.MatchDraft,
      draftRefs: MatchDraftRefs,
  ): Either[AppError, Unit] =
    val allowedStatuses = Set(
      momo.api.domain.MatchDraftStatus.DraftReady,
      momo.api.domain.MatchDraftStatus.NeedsReview,
      momo.api.domain.MatchDraftStatus.OcrFailed,
    )
    if !allowedStatuses.contains(draft.status) then
      Left(AppError.Conflict(s"match draft in status=${draft.status.wire} cannot be confirmed."))
    else if draft.totalAssetsDraftId != draftRefs.totalAssets then
      Left(
        AppError.ValidationFailed("draftIds.totalAssets does not match the match draft snapshot.")
      )
    else if draft.revenueDraftId != draftRefs.revenue then
      Left(AppError.ValidationFailed("draftIds.revenue does not match the match draft snapshot."))
    else if draft.incidentLogDraftId != draftRefs.incidentLog then
      Left(
        AppError.ValidationFailed("draftIds.incidentLog does not match the match draft snapshot.")
      )
    else Right(())
