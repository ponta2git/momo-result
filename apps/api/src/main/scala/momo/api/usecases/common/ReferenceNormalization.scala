package momo.api.usecases.common

import cats.Functor
import cats.syntax.all.*

import momo.api.domain.PlayerResult
import momo.api.domain.ids.*
import momo.api.repositories.EntityReferenceResolver
import momo.api.repositories.EntityReferenceResolver.{Kind, Resolved}
import momo.api.usecases.matchdrafts.{CreateMatchDraftCommand, UpdateMatchDraftCommand}
import momo.api.usecases.matches.{ConfirmMatchCommand, MatchDraftRefs, UpdateMatchCommand}
import momo.api.usecases.ocr.PutOcrSubmissionCommand

/** Domain and persisted calculation inputs use legacy identities; HTTP hashing precedes this step. */
private[usecases] object ReferenceNormalization:
  private def optional(kind: Kind, value: Option[String]): List[(Kind, String)] =
    value.toList.map(kind -> _)

  private def draftRefs(value: MatchDraftRefs): List[(Kind, String)] =
    List(value.totalAssets, value.revenue, value.incidentLog).flatten.map(id =>
      Kind.OcrDraft -> id.value
    )

  private def resolvedDrafts(value: MatchDraftRefs, ids: Resolved): MatchDraftRefs = MatchDraftRefs(
    value.totalAssets.map(id => OcrDraftId.unsafeFromString(ids(Kind.OcrDraft, id.value))),
    value.revenue.map(id => OcrDraftId.unsafeFromString(ids(Kind.OcrDraft, id.value))),
    value.incidentLog.map(id => OcrDraftId.unsafeFromString(ids(Kind.OcrDraft, id.value)))
  )

  private def players(values: List[PlayerResult.Input], ids: Resolved): List[PlayerResult.Input] =
    values.map(player =>
      player.copy(memberId = MemberId.unsafeFromString(ids(Kind.Member, player.memberId.value)))
    )

  def confirm[F[_]: Functor](
      command: ConfirmMatchCommand,
      resolver: EntityReferenceResolver[F]
  ): F[ConfirmMatchCommand] =
    resolver.resolve(List(
      Kind.HeldEvent -> command.heldEventId.value,
      Kind.GameTitle -> command.gameTitleId.value,
      Kind.MapMaster -> command.mapMasterId.value,
      Kind.SeasonMaster -> command.seasonMasterId.value,
      Kind.Member -> command.ownerMemberId.value
    ) ++ command.players.map(player => Kind.Member -> player.memberId.value) ++
      draftRefs(command.draftRefs) ++
      optional(Kind.MatchDraft, command.matchDraftId.map(_.value))).map(ids =>
      command.copy(
        heldEventId = HeldEventId.unsafeFromString(ids(Kind.HeldEvent, command.heldEventId.value)),
        gameTitleId = GameTitleId.unsafeFromString(ids(Kind.GameTitle, command.gameTitleId.value)),
        mapMasterId = MapMasterId.unsafeFromString(ids(Kind.MapMaster, command.mapMasterId.value)),
        seasonMasterId =
          SeasonMasterId.unsafeFromString(ids(Kind.SeasonMaster, command.seasonMasterId.value)),
        ownerMemberId = MemberId.unsafeFromString(ids(Kind.Member, command.ownerMemberId.value)),
        matchDraftId = command.matchDraftId.map(id =>
          MatchDraftId.unsafeFromString(ids(Kind.MatchDraft, id.value))
        ),
        draftRefs = resolvedDrafts(command.draftRefs, ids),
        players = players(command.players, ids)
      )
    )

  def update[F[_]: Functor](
      command: UpdateMatchCommand,
      resolver: EntityReferenceResolver[F]
  ): F[UpdateMatchCommand] =
    resolver.resolve(List(
      Kind.HeldEvent -> command.heldEventId.value,
      Kind.GameTitle -> command.gameTitleId.value,
      Kind.MapMaster -> command.mapMasterId.value,
      Kind.SeasonMaster -> command.seasonMasterId.value,
      Kind.Member -> command.ownerMemberId.value
    ) ++ command.players.map(player => Kind.Member -> player.memberId.value) ++
      draftRefs(command.draftRefs)).map(ids =>
      command.copy(
        heldEventId = HeldEventId.unsafeFromString(ids(Kind.HeldEvent, command.heldEventId.value)),
        gameTitleId = GameTitleId.unsafeFromString(ids(Kind.GameTitle, command.gameTitleId.value)),
        mapMasterId = MapMasterId.unsafeFromString(ids(Kind.MapMaster, command.mapMasterId.value)),
        seasonMasterId =
          SeasonMasterId.unsafeFromString(ids(Kind.SeasonMaster, command.seasonMasterId.value)),
        ownerMemberId = MemberId.unsafeFromString(ids(Kind.Member, command.ownerMemberId.value)),
        draftRefs = resolvedDrafts(command.draftRefs, ids),
        players = players(command.players, ids)
      )
    )

  def createDraft[F[_]: Functor](
      command: CreateMatchDraftCommand,
      resolver: EntityReferenceResolver[F]
  ): F[CreateMatchDraftCommand] =
    resolver.resolve(optional(Kind.HeldEvent, command.heldEventId.map(_.value)) ++
      optional(Kind.GameTitle, command.gameTitleId.map(_.value)) ++
      optional(Kind.MapMaster, command.mapMasterId.map(_.value)) ++
      optional(Kind.SeasonMaster, command.seasonMasterId.map(_.value)) ++
      optional(Kind.Member, command.ownerMemberId.map(_.value)))
      .map(ids =>
        command.copy(
          heldEventId = command.heldEventId.map(id =>
            HeldEventId.unsafeFromString(ids(Kind.HeldEvent, id.value))
          ),
          gameTitleId = command.gameTitleId.map(id =>
            GameTitleId.unsafeFromString(ids(Kind.GameTitle, id.value))
          ),
          mapMasterId = command.mapMasterId.map(id =>
            MapMasterId.unsafeFromString(ids(Kind.MapMaster, id.value))
          ),
          seasonMasterId = command.seasonMasterId.map(id =>
            SeasonMasterId.unsafeFromString(ids(Kind.SeasonMaster, id.value))
          ),
          ownerMemberId =
            command.ownerMemberId.map(id => MemberId.unsafeFromString(ids(Kind.Member, id.value)))
        )
      )

  def updateDraft[F[_]: Functor](
      command: UpdateMatchDraftCommand,
      resolver: EntityReferenceResolver[F]
  ): F[UpdateMatchDraftCommand] =
    resolver.resolve(optional(Kind.HeldEvent, command.heldEventId.map(_.value)) ++
      optional(Kind.GameTitle, command.gameTitleId.map(_.value)) ++
      optional(Kind.MapMaster, command.mapMasterId.map(_.value)) ++
      optional(Kind.SeasonMaster, command.seasonMasterId.map(_.value)) ++
      optional(Kind.Member, command.ownerMemberId.map(_.value)))
      .map(ids =>
        command.copy(
          heldEventId = command.heldEventId.map(id =>
            HeldEventId.unsafeFromString(ids(Kind.HeldEvent, id.value))
          ),
          gameTitleId = command.gameTitleId.map(id =>
            GameTitleId.unsafeFromString(ids(Kind.GameTitle, id.value))
          ),
          mapMasterId = command.mapMasterId.map(id =>
            MapMasterId.unsafeFromString(ids(Kind.MapMaster, id.value))
          ),
          seasonMasterId = command.seasonMasterId.map(id =>
            SeasonMasterId.unsafeFromString(ids(Kind.SeasonMaster, id.value))
          ),
          ownerMemberId =
            command.ownerMemberId.map(id => MemberId.unsafeFromString(ids(Kind.Member, id.value)))
        )
      )

  def submission[F[_]: Functor](
      command: PutOcrSubmissionCommand,
      resolver: EntityReferenceResolver[F]
  ): F[PutOcrSubmissionCommand] =
    resolver.resolve(List(Kind.MatchDraft -> command.matchDraftId.value) ++
      command.hints.knownPlayerAliases.map(hint => Kind.Member -> hint.memberId.value)).map(ids =>
      command.copy(
        matchDraftId =
          MatchDraftId.unsafeFromString(ids(Kind.MatchDraft, command.matchDraftId.value)),
        hints = command.hints.copy(knownPlayerAliases =
          command.hints.knownPlayerAliases.map(hint =>
            hint.copy(memberId = MemberId.unsafeFromString(ids(Kind.Member, hint.memberId.value)))
          )
        )
      )
    )
