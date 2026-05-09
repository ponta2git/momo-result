package momo.api.endpoints

import java.time.Instant

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{
  FourPlayers, IncidentCounts, MatchListItem, MatchListItemKind, MatchListRankEntry, MatchRecord,
  PlayerResult,
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

  private val zeroIncidents = IncidentCounts(
    destination = 0,
    plusStation = 0,
    minusStation = 0,
    cardStation = 0,
    cardShop = 0,
    suriNoGinji = 0,
  )

  private def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult(
    memberId = MemberId(memberId),
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = 100 * rank,
    revenueManYen = 50 * rank,
    incidents = zeroIncidents,
  )

  private val matchRecord = MatchRecord(
    id = MatchId("match_001"),
    heldEventId = HeldEventId("held_2026_04_30"),
    matchNoInEvent = 1,
    gameTitleId = GameTitleId("title_world"),
    layoutFamily = "world",
    seasonMasterId = SeasonMasterId("season_2024_spring"),
    ownerMemberId = MemberId("member_a"),
    mapMasterId = MapMasterId("map_east"),
    playedAt = playedAt,
    totalAssetsDraftId = Some(OcrDraftId("draft_total_assets")),
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      player("member_a", playOrder = 1, rank = 1),
      player("member_b", playOrder = 2, rank = 2),
      player("member_c", playOrder = 3, rank = 3),
      player("member_d", playOrder = 4, rank = 4),
    ),
    createdByMemberId = MemberId("member_a"),
    createdAt = createdAt,
  )

  private val matchListItem = MatchListItem(
    kind = MatchListItemKind.Match,
    id = "match_001",
    matchId = Some(MatchId("match_001")),
    matchDraftId = None,
    status = "confirmed",
    heldEventId = Some(HeldEventId("held_2026_04_30")),
    matchNoInEvent = Some(1),
    gameTitleId = Some(GameTitleId("title_world")),
    seasonMasterId = Some(SeasonMasterId("season_2024_spring")),
    mapMasterId = Some(MapMasterId("map_east")),
    ownerMemberId = Some(MemberId("member_a")),
    playedAt = Some(playedAt),
    createdAt = createdAt,
    updatedAt = updatedAt,
    ranks = List(
      MatchListRankEntry(memberId = MemberId("member_a"), rank = 1, playOrder = 1),
      MatchListRankEntry(memberId = MemberId("member_b"), rank = 2, playOrder = 2),
      MatchListRankEntry(memberId = MemberId("member_c"), rank = 3, playOrder = 3),
      MatchListRankEntry(memberId = MemberId("member_d"), rank = 4, playOrder = 4),
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
        "createdByAccountId": "member_a",
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
