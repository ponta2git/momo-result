package momo.api.domain

import java.time.Instant

import cats.data.EitherNec
import cats.syntax.all.*

import momo.api.domain.ids.*

final case class MatchNoteBody private (value: String) derives CanEqual

object MatchNoteBody:
  val MaximumCodePoints = 150

  def fromString(raw: String): Either[String, Option[MatchNoteBody]] =
    val normalized = raw.replace("\r\n", "\n").replace('\r', '\n')
    val isBlank = normalized.codePoints()
      .allMatch(codePoint => Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint))
    if isBlank then Right(None)
    else
      val length = normalized.codePointCount(0, normalized.length)
      Either.cond(
        length <= MaximumCodePoints,
        Some(MatchNoteBody(normalized)),
        s"match note must be at most $MaximumCodePoints characters",
      )

  def fromRequiredString(raw: String): Either[String, MatchNoteBody] =
    fromString(raw).flatMap(_.toRight("match note must not be blank"))

final case class MatchNoteVersion private (value: Long) derives CanEqual:
  def next: MatchNoteVersion = MatchNoteVersion(value + 1L)

object MatchNoteVersion:
  val Initial: MatchNoteVersion = MatchNoteVersion(0L)
  def fromLong(value: Long): Either[String, MatchNoteVersion] =
    Either.cond(value >= 0L, MatchNoteVersion(value), "match note version must be non-negative")
  def fromWire(value: String): Either[String, MatchNoteVersion] =
    value.toLongOption.toRight("match note version must be an integer").flatMap(fromLong)

final case class MatchNote(
    body: Option[MatchNoteBody],
    version: MatchNoteVersion,
    updatedByAccountId: Option[AccountId],
    updatedAt: Option[Instant],
) derives CanEqual

object MatchNote:
  val Empty: MatchNote = MatchNote(None, MatchNoteVersion.Initial, None, None)

  def persisted(
      body: Option[MatchNoteBody],
      version: MatchNoteVersion,
      updatedByAccountId: Option[AccountId],
      updatedAt: Option[Instant],
  ): Either[String, MatchNote] =
    val metadataComplete = updatedByAccountId.isDefined && updatedAt.isDefined
    val valid =
      if version == MatchNoteVersion.Initial then
        body.isEmpty && !metadataComplete &&
        updatedByAccountId.isEmpty && updatedAt.isEmpty
      else metadataComplete
    Either.cond(
      valid,
      MatchNote(body, version, updatedByAccountId, updatedAt),
      "match note version and attribution metadata are inconsistent",
    )

final case class IncidentCounts(
    destination: IncidentCount,
    plusStation: IncidentCount,
    minusStation: IncidentCount,
    cardStation: IncidentCount,
    cardShop: IncidentCount,
    suriNoGinji: IncidentCount,
):
  /**
   * Pairs each count with its [[IncidentKind]] in the canonical order. The repository layer is
   * responsible for translating each kind to the corresponding `incident_masters.id`.
   */
  def entriesByKind: List[(IncidentKind, IncidentCount)] = List(
    IncidentKind.Destination -> destination,
    IncidentKind.PlusStation -> plusStation,
    IncidentKind.MinusStation -> minusStation,
    IncidentKind.CardStation -> cardStation,
    IncidentKind.CardShop -> cardShop,
    IncidentKind.SuriNoGinji -> suriNoGinji,
  )

object IncidentCounts:
  final case class Input(
      destination: Int,
      plusStation: Int,
      minusStation: Int,
      cardStation: Int,
      cardShop: Int,
      suriNoGinji: Int,
  )

  def fromInput(input: Input): EitherNec[MatchValidationError, IncidentCounts] = (
    IncidentCount.fromInt(input.destination).toEitherNec,
    IncidentCount.fromInt(input.plusStation).toEitherNec,
    IncidentCount.fromInt(input.minusStation).toEitherNec,
    IncidentCount.fromInt(input.cardStation).toEitherNec,
    IncidentCount.fromInt(input.cardShop).toEitherNec,
    IncidentCount.fromInt(input.suriNoGinji).toEitherNec,
  ).parMapN(IncidentCounts.apply)

  def unsafeFromInts(
      destination: Int,
      plusStation: Int,
      minusStation: Int,
      cardStation: Int,
      cardShop: Int,
      suriNoGinji: Int,
  ): IncidentCounts = IncidentCounts(
    destination = IncidentCount.unsafeFromInt(destination),
    plusStation = IncidentCount.unsafeFromInt(plusStation),
    minusStation = IncidentCount.unsafeFromInt(minusStation),
    cardStation = IncidentCount.unsafeFromInt(cardStation),
    cardShop = IncidentCount.unsafeFromInt(cardShop),
    suriNoGinji = IncidentCount.unsafeFromInt(suriNoGinji),
  )

  /** Builds an `IncidentCounts` from a trusted kind-keyed map, defaulting missing kinds to 0. */
  def fromKindMap(values: Map[IncidentKind, Int]): IncidentCounts = IncidentCounts(
    destination = IncidentCount.unsafeFromInt(values.getOrElse(IncidentKind.Destination, 0)),
    plusStation = IncidentCount.unsafeFromInt(values.getOrElse(IncidentKind.PlusStation, 0)),
    minusStation = IncidentCount.unsafeFromInt(values.getOrElse(IncidentKind.MinusStation, 0)),
    cardStation = IncidentCount.unsafeFromInt(values.getOrElse(IncidentKind.CardStation, 0)),
    cardShop = IncidentCount.unsafeFromInt(values.getOrElse(IncidentKind.CardShop, 0)),
    suriNoGinji = IncidentCount.unsafeFromInt(values.getOrElse(IncidentKind.SuriNoGinji, 0)),
  )

final case class PlayerResult(
    memberId: MemberId,
    playOrder: PlayOrder,
    rank: Rank,
    totalAssetsManYen: ManYen,
    revenueManYen: ManYen,
    incidents: IncidentCounts,
)

object PlayerResult:
  final case class Input(
      memberId: MemberId,
      playOrder: Int,
      rank: Int,
      totalAssetsManYen: Int,
      revenueManYen: Int,
      incidents: IncidentCounts.Input,
  )

  def fromInput(input: Input): EitherNec[MatchValidationError, PlayerResult] = (
    PlayOrder.fromInt(input.playOrder).toEitherNec,
    Rank.fromInt(input.rank).toEitherNec,
    IncidentCounts.fromInput(input.incidents),
  ).parMapN { (playOrder, rank, incidents) =>
    PlayerResult(
      memberId = input.memberId,
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = ManYen.fromInt(input.totalAssetsManYen),
      revenueManYen = ManYen.fromInt(input.revenueManYen),
      incidents = incidents,
    )
  }

  def unsafeFromInts(
      memberId: MemberId,
      playOrder: Int,
      rank: Int,
      totalAssetsManYen: Int,
      revenueManYen: Int,
      incidents: IncidentCounts,
  ): PlayerResult = PlayerResult(
    memberId = memberId,
    playOrder = PlayOrder.unsafeFromInt(playOrder),
    rank = Rank.unsafeFromInt(rank),
    totalAssetsManYen = ManYen.unsafeFromInt(totalAssetsManYen),
    revenueManYen = ManYen.unsafeFromInt(revenueManYen),
    incidents = incidents,
  )

final case class MatchRecord(
    id: MatchId,
    heldEventId: HeldEventId,
    matchNoInEvent: MatchNoInEvent,
    gameTitleId: GameTitleId,
    layoutFamily: String,
    seasonMasterId: SeasonMasterId,
    ownerMemberId: MemberId,
    mapMasterId: MapMasterId,
    playedAt: Instant,
    totalAssetsDraftId: Option[OcrDraftId],
    revenueDraftId: Option[OcrDraftId],
    incidentLogDraftId: Option[OcrDraftId],
    players: FourPlayers,
    createdByAccountId: AccountId,
    createdByMemberId: Option[MemberId],
    createdAt: Instant,
    note: MatchNote = MatchNote.Empty,
)

object MatchRecord:
  final case class ValidatedInput(
      heldEventId: HeldEventId,
      matchNoInEvent: MatchNoInEvent,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      players: FourPlayers,
  )
