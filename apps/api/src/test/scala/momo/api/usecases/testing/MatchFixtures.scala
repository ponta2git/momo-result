package momo.api.usecases.testing

import java.time.Instant

import cats.effect.IO

import momo.api.domain.ids.*
import momo.api.domain.{
  FourPlayers,
  GameTitle,
  HeldEvent,
  IncidentCounts,
  MapMaster,
  MatchNoInEvent,
  MatchRecord,
  Member,
  PlayerResult,
  SeasonMaster
}
import momo.api.repositories.{
  GameTitlesRepository,
  HeldEventsRepository,
  MapMastersRepository,
  SeasonMastersRepository
}

object MatchFixtures:
  val DevMemberValues: List[String] = List("ponta", "akane-mami", "otaka", "eu")
  val DbMemberValues: List[String] =
    List("member_ponta", "member_akane_mami", "member_otaka", "member_eu")

  val zeroIncidents: IncidentCounts = IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0)

  def allowedMembers(memberValues: List[String]): Set[MemberId] = memberValues
    .map(MemberId.unsafeFromString).toSet

  def members(memberValues: List[String], createdAt: Instant): List[Member] = memberValues
    .map(id => Member(MemberId.unsafeFromString(id), UserId.unsafeFromString(id), id, createdAt))

  def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult
    .unsafeFromInts(
      memberId = MemberId.unsafeFromString(memberId),
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = 100,
      revenueManYen = 50,
      incidents = zeroIncidents,
    )

  def playerInput(memberId: String, playOrder: Int, rank: Int): PlayerResult.Input = PlayerResult
    .Input(
      memberId = MemberId.unsafeFromString(memberId),
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = 100,
      revenueManYen = 50,
      incidents = IncidentCounts.Input(0, 0, 0, 0, 0, 0),
    )

  def defaultPlayers(memberValues: List[String]): List[PlayerResult] =
    val members = fourMemberValues(memberValues)
    List(
      player(members(0), 1, 1),
      player(members(1), 2, 2),
      player(members(2), 3, 3),
      player(members(3), 4, 4),
    )

  def duplicateRankPlayers(memberValues: List[String]): List[PlayerResult] =
    val members = fourMemberValues(memberValues)
    List(
      player(members(0), 1, 1),
      player(members(1), 2, 1),
      player(members(2), 3, 3),
      player(members(3), 4, 4),
    )

  def defaultPlayerInputs(memberValues: List[String]): List[PlayerResult.Input] =
    val members = fourMemberValues(memberValues)
    List(
      playerInput(members(0), 1, 1),
      playerInput(members(1), 2, 2),
      playerInput(members(2), 3, 3),
      playerInput(members(3), 4, 4),
    )

  def duplicateRankPlayerInputs(memberValues: List[String]): List[PlayerResult.Input] =
    val members = fourMemberValues(memberValues)
    List(
      playerInput(members(0), 1, 1),
      playerInput(members(1), 2, 1),
      playerInput(members(2), 3, 3),
      playerInput(members(3), 4, 4),
    )

  def fourPlayers(memberValues: List[String]): FourPlayers = defaultPlayers(memberValues) match
    case a :: b :: c :: d :: _ => FourPlayers(a, b, c, d)
    case _ => FourPlayers(
        player("missing_member_1", 1, 1),
        player("missing_member_2", 2, 2),
        player("missing_member_3", 3, 3),
        player("missing_member_4", 4, 4),
      )

  def seedWorldMasters(
      gameTitles: GameTitlesRepository[IO],
      mapMasters: MapMastersRepository[IO],
      seasonMasters: SeasonMastersRepository[IO],
      titleId: GameTitleId,
      mapId: MapMasterId,
      seasonId: SeasonMasterId,
      createdAt: Instant,
  ): IO[Unit] =
    for
      _ <- gameTitles.create(GameTitle(titleId, "World", "world", 1, createdAt))
      _ <- mapMasters.create(MapMaster(mapId, titleId, "East", 1, createdAt))
      _ <- seasonMasters.create(SeasonMaster(seasonId, titleId, "Spring", 1, createdAt))
    yield ()

  def seedWorldPrereqs(
      heldEvents: HeldEventsRepository[IO],
      gameTitles: GameTitlesRepository[IO],
      mapMasters: MapMastersRepository[IO],
      seasonMasters: SeasonMastersRepository[IO],
      heldEventId: HeldEventId,
      titleId: GameTitleId,
      mapId: MapMasterId,
      seasonId: SeasonMasterId,
      createdAt: Instant,
  ): IO[Unit] =
    for
      _ <- heldEvents.create(HeldEvent(heldEventId, createdAt))
      _ <-
        seedWorldMasters(gameTitles, mapMasters, seasonMasters, titleId, mapId, seasonId, createdAt)
    yield ()

  def matchRecord(
      id: MatchId,
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      titleId: GameTitleId,
      seasonId: SeasonMasterId,
      mapId: MapMasterId,
      playedAt: Instant,
      createdAt: Instant,
      memberValues: List[String],
      totalAssetsDraftId: Option[OcrDraftId],
      revenueDraftId: Option[OcrDraftId],
      incidentLogDraftId: Option[OcrDraftId],
  ): MatchRecord =
    val ownerMemberId = MemberId.unsafeFromString(fourMemberValues(memberValues).head)
    MatchRecord(
      id = id,
      heldEventId = heldEventId,
      matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNoInEvent),
      gameTitleId = titleId,
      layoutFamily = "world",
      seasonMasterId = seasonId,
      ownerMemberId = ownerMemberId,
      mapMasterId = mapId,
      playedAt = playedAt,
      totalAssetsDraftId = totalAssetsDraftId,
      revenueDraftId = revenueDraftId,
      incidentLogDraftId = incidentLogDraftId,
      players = fourPlayers(memberValues),
      createdByAccountId = AccountId.unsafeFromString(ownerMemberId.value),
      createdByMemberId = Some(ownerMemberId),
      createdAt = createdAt,
    )

  private def fourMemberValues(memberValues: List[String]): Vector[String] = memberValues
    .padTo(4, "missing_member").take(4).toVector
