package momo.api.domain

import java.time.Instant

import cats.data.EitherNec
import cats.syntax.all.*

import momo.api.domain.ids.*

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
