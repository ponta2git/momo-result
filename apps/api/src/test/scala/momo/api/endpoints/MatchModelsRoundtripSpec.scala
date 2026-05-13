package momo.api.endpoints

import java.time.Instant

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{
  FourPlayers, IncidentCounts, MatchListItem, MatchListItemKind, MatchListRankEntry, MatchNoInEvent,
  MatchRecord, PlayOrder, PlayerResult, Rank,
}

/**
 * Roundtrip + golden-JSON guard for [[MatchDetailResponse]] and [[MatchSummaryResponse]].
 *
 * See [[HeldEventResponseRoundtripSpec]] for the rationale: locking the wire format here lets the
 * upcoming Phase 2 ADT refactor (`MatchRecord.players` → `FourPlayers`, `MatchListItem` →
 * sealed states) be performed without silently changing the JSON the SPA depends on.
 */
final class MatchModelsRoundtripSpec extends FunSuite:

  private val playedAt = Instant.parse("2026-04-30T12:00:00Z")
  private val createdAt = Instant.parse("2026-04-30T13:00:00Z")
  private val updatedAt = Instant.parse("2026-04-30T13:30:00Z")

  private val zeroIncidents = IncidentCounts.unsafeFromInts(
    destination = 0,
    plusStation = 0,
    minusStation = 0,
    cardStation = 0,
    cardShop = 0,
    suriNoGinji = 0,
  )

  private def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult
    .unsafeFromInts(
      memberId = MemberId.unsafeFromString(memberId),
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = 100 * rank,
      revenueManYen = 50 * rank,
      incidents = zeroIncidents,
    )

  private val matchRecord = MatchRecord(
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
      player("member_a", playOrder = 1, rank = 1),
      player("member_b", playOrder = 2, rank = 2),
      player("member_c", playOrder = 3, rank = 3),
      player("member_d", playOrder = 4, rank = 4),
    ),
    createdByAccountId = AccountId.unsafeFromString("account_a"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_a")),
    createdAt = createdAt,
  )

  private val matchListItem = MatchListItem(
    kind = MatchListItemKind.Match,
    id = "match_001",
    matchId = Some(MatchId.unsafeFromString("match_001")),
    matchDraftId = None,
    status = "confirmed",
    heldEventId = Some(HeldEventId.unsafeFromString("held_2026_04_30")),
    matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(1)),
    gameTitleId = Some(GameTitleId.unsafeFromString("title_world")),
    seasonMasterId = Some(SeasonMasterId.unsafeFromString("season_2024_spring")),
    mapMasterId = Some(MapMasterId.unsafeFromString("map_east")),
    ownerMemberId = Some(MemberId.unsafeFromString("member_a")),
    playedAt = Some(playedAt),
    createdAt = createdAt,
    updatedAt = updatedAt,
    ranks = List(
      MatchListRankEntry(
        memberId = MemberId.unsafeFromString("member_a"),
        rank = Rank.unsafeFromInt(1),
        playOrder = PlayOrder.unsafeFromInt(1),
      ),
      MatchListRankEntry(
        memberId = MemberId.unsafeFromString("member_b"),
        rank = Rank.unsafeFromInt(2),
        playOrder = PlayOrder.unsafeFromInt(2),
      ),
      MatchListRankEntry(
        memberId = MemberId.unsafeFromString("member_c"),
        rank = Rank.unsafeFromInt(3),
        playOrder = PlayOrder.unsafeFromInt(3),
      ),
      MatchListRankEntry(
        memberId = MemberId.unsafeFromString("member_d"),
        rank = Rank.unsafeFromInt(4),
        playOrder = PlayOrder.unsafeFromInt(4),
      ),
    ),
  )

  test("MatchDetailResponse: encode → decode is identity"):
    val response = MatchDetailResponse.from(matchRecord)
    val decoded = response.asJson.as[MatchDetailResponse]
    assertEquals(decoded, Right(response))

  test("MatchDetailResponse: golden JSON pins the wire format"):
    val response = MatchDetailResponse.from(matchRecord)
    val expected = parse("""
      {
        "matchId": "match_001",
        "heldEventId": "held_2026_04_30",
        "matchNoInEvent": 1,
        "gameTitleId": "title_world",
        "layoutFamily": "world",
        "seasonMasterId": "season_2024_spring",
        "ownerMemberId": "member_a",
        "mapMasterId": "map_east",
        "playedAt": "2026-04-30T12:00:00Z",
        "totalAssetsDraftId": "draft_total_assets",
        "revenueDraftId": null,
        "incidentLogDraftId": null,
        "players": [
          {
            "memberId": "member_a",
            "playOrder": 1,
            "rank": 1,
            "totalAssetsManYen": 100,
            "revenueManYen": 50,
            "incidents": {
              "destination": 0,
              "plusStation": 0,
              "minusStation": 0,
              "cardStation": 0,
              "cardShop": 0,
              "suriNoGinji": 0
            }
          },
          {
            "memberId": "member_b",
            "playOrder": 2,
            "rank": 2,
            "totalAssetsManYen": 200,
            "revenueManYen": 100,
            "incidents": {
              "destination": 0,
              "plusStation": 0,
              "minusStation": 0,
              "cardStation": 0,
              "cardShop": 0,
              "suriNoGinji": 0
            }
          },
          {
            "memberId": "member_c",
            "playOrder": 3,
            "rank": 3,
            "totalAssetsManYen": 300,
            "revenueManYen": 150,
            "incidents": {
              "destination": 0,
              "plusStation": 0,
              "minusStation": 0,
              "cardStation": 0,
              "cardShop": 0,
              "suriNoGinji": 0
            }
          },
          {
            "memberId": "member_d",
            "playOrder": 4,
            "rank": 4,
            "totalAssetsManYen": 400,
            "revenueManYen": 200,
            "incidents": {
              "destination": 0,
              "plusStation": 0,
              "minusStation": 0,
              "cardStation": 0,
              "cardShop": 0,
              "suriNoGinji": 0
            }
          }
        ],
        "createdByAccountId": "account_a",
        "createdByMemberId": "member_a",
        "createdAt": "2026-04-30T13:00:00Z"
      }
    """).getOrElse(Json.Null)
    assertEquals(response.asJson, expected)

  test("MatchSummaryResponse: encode → decode is identity"):
    val response = MatchSummaryResponse.from(matchListItem)
    val decoded = response.asJson.as[MatchSummaryResponse]
    assertEquals(decoded, Right(response))

  test("MatchSummaryResponse: golden JSON pins the wire format"):
    val response = MatchSummaryResponse.from(matchListItem)
    val expected = parse("""
      {
        "kind": "match",
        "id": "match_001",
        "matchId": "match_001",
        "matchDraftId": null,
        "status": "confirmed",
        "heldEventId": "held_2026_04_30",
        "matchNoInEvent": 1,
        "gameTitleId": "title_world",
        "seasonMasterId": "season_2024_spring",
        "mapMasterId": "map_east",
        "ownerMemberId": "member_a",
        "playedAt": "2026-04-30T12:00:00Z",
        "createdAt": "2026-04-30T13:00:00Z",
        "updatedAt": "2026-04-30T13:30:00Z",
        "ranks": [
          { "memberId": "member_a", "rank": 1, "playOrder": 1 },
          { "memberId": "member_b", "rank": 2, "playOrder": 2 },
          { "memberId": "member_c", "rank": 3, "playOrder": 3 },
          { "memberId": "member_d", "rank": 4, "playOrder": 4 }
        ]
      }
    """).getOrElse(Json.Null)
    assertEquals(response.asJson, expected)
end MatchModelsRoundtripSpec
