package momo.api.endpoints

import java.time.Instant

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{FourPlayers, IncidentCounts, MatchNoInEvent, MatchRecord, PlayerResult}

final class MatchDetailResponseSpec extends FunSuite:
  private val playedAt = Instant.parse("2026-04-30T12:00:00Z")
  private val createdAt = Instant.parse("2026-04-30T13:00:00Z")
  private val zeroIncidents = IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0)

  test("maps domain identity, optional provenance, and player order for the detail consumer"):
    val detailedPlayer = PlayerResult.unsafeFromInts(
      MemberId.unsafeFromString("member_a"),
      playOrder = 1,
      rank = 2,
      totalAssetsManYen = 1234,
      revenueManYen = 567,
      incidents = IncidentCounts.unsafeFromInts(11, 12, 13, 14, 15, 16),
    )
    val response = MatchDetailResponse.from(MatchRecord(
      id = MatchId.unsafeFromString("match_001"),
      heldEventId = HeldEventId.unsafeFromString("held_2026_04_30"),
      matchNoInEvent = MatchNoInEvent.unsafeFromInt(1),
      gameTitleId = GameTitleId.unsafeFromString("title_world"),
      layoutFamily = "world",
      seasonMasterId = SeasonMasterId.unsafeFromString("season_2024_spring"),
      ownerMemberId = MemberId.unsafeFromString("member_a"),
      mapMasterId = MapMasterId.unsafeFromString("map_east"),
      playedAt = playedAt,
      totalAssetsDraftId = Some(OcrDraftId.unsafeFromString("draft_total_assets")),
      revenueDraftId = None,
      incidentLogDraftId = None,
      players = FourPlayers(
        player("member_b", playOrder = 2, rank = 1),
        detailedPlayer,
        player("member_d", playOrder = 4, rank = 3),
        player("member_c", playOrder = 3, rank = 4),
      ),
      createdByAccountId = AccountId.unsafeFromString("account_a"),
      createdByMemberId = Some(MemberId.unsafeFromString("member_a")),
      createdAt = createdAt,
    ))

    assertEquals(response.matchId, "match_001")
    assertEquals(response.totalAssetsDraftId, Some("draft_total_assets"))
    assertEquals(response.revenueDraftId, None)
    assertEquals(response.createdByAccountId, "account_a")
    assertEquals(
      response.players.map(player => (player.memberId, player.playOrder, player.rank)),
      List(
        ("member_a", 1, 2),
        ("member_b", 2, 1),
        ("member_c", 3, 4),
        ("member_d", 4, 3),
      ),
    )
    assertEquals(
      response.players.headOption,
      Some(PlayerResultResponse(
        memberId = "member_a",
        playOrder = 1,
        rank = 2,
        totalAssetsManYen = 1234,
        revenueManYen = 567,
        incidents = IncidentCountsResponse(
          destination = 11,
          plusStation = 12,
          minusStation = 13,
          cardStation = 14,
          cardShop = 15,
          suriNoGinji = 16,
        ),
      )),
    )

  private def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult
    .unsafeFromInts(
      MemberId.unsafeFromString(memberId),
      playOrder,
      rank,
      totalAssetsManYen = 100 * rank,
      revenueManYen = 50 * rank,
      incidents = zeroIncidents,
    )

end MatchDetailResponseSpec
