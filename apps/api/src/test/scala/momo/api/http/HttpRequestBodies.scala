package momo.api.http

import io.circe.Json
import io.circe.syntax.*

import momo.api.endpoints.{
  ConfirmMatchDraftIds, ConfirmMatchRequest, CreateGameTitleRequest, CreateHeldEventRequest,
  CreateMapMasterRequest, CreateMatchDraftRequest, CreateOcrJobRequest, CreateSeasonMasterRequest,
  IncidentCountsRequest, PlayerResultRequest,
}

object HttpRequestBodies:
  object Master:
    def gameTitleWorld: Json =
      createGameTitle("title_world", "桃太郎電鉄ワールド", "world")

    def createGameTitle(id: String, name: String, layoutFamily: String): Json =
      CreateGameTitleRequest(id, name, layoutFamily).asJson

    def createMapMaster(id: String, name: String): Json =
      createMapMasterForTitle(id, "title_world", name)

    def createMapMasterForTitle(id: String, gameTitleId: String, name: String): Json =
      CreateMapMasterRequest(id, gameTitleId, name).asJson

    def createSeasonMaster(id: String, name: String): Json =
      createSeasonMasterForTitle(id, "title_world", name)

    def createSeasonMasterForTitle(id: String, gameTitleId: String, name: String): Json =
      CreateSeasonMasterRequest(id, gameTitleId, name).asJson

  object Matches:
    def createHeldEvent(heldAt: String): Json = CreateHeldEventRequest(heldAt).asJson

    def emptyMatchDraft: Json = CreateMatchDraftRequest(
      heldEventId = None,
      matchNoInEvent = None,
      gameTitleId = None,
      layoutFamily = None,
      seasonMasterId = None,
      ownerMemberId = None,
      mapMasterId = None,
      playedAt = None,
      status = None,
    ).asJson

    def createOcrJob(imageId: String, requestedImageType: String): Json = CreateOcrJobRequest(
      imageId = imageId,
      requestedImageType = requestedImageType,
    ).asJson

    def createOcrJobForDraft(
        imageId: String,
        requestedImageType: String,
        matchDraftId: String,
    ): Json = CreateOcrJobRequest(
      imageId = imageId,
      requestedImageType = requestedImageType,
      matchDraftId = Some(matchDraftId),
    ).asJson

    def defaultIncidentCounts: IncidentCountsRequest = incidentCounts(1, 0, 0, 0, 0, 0)

    def incidentCounts(
        destination: Int,
        plusStation: Int,
        minusStation: Int,
        cardStation: Int,
        cardShop: Int,
        suriNoGinji: Int,
    ): IncidentCountsRequest = IncidentCountsRequest(
      destination = destination,
      plusStation = plusStation,
      minusStation = minusStation,
      cardStation = cardStation,
      cardShop = cardShop,
      suriNoGinji = suriNoGinji,
    )

    def player(
        memberId: String,
        playOrder: Int,
        rank: Int,
    ): PlayerResultRequest = playerWithScores(
      memberId = memberId,
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = 100,
      revenueManYen = 50,
      incidents = defaultIncidentCounts,
    )

    def playerWithScores(
        memberId: String,
        playOrder: Int,
        rank: Int,
        totalAssetsManYen: Int,
        revenueManYen: Int,
        incidents: IncidentCountsRequest,
    ): PlayerResultRequest = PlayerResultRequest(
      memberId = memberId,
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = totalAssetsManYen,
      revenueManYen = revenueManYen,
      incidents = incidents,
    )

    private def defaultPlayers: List[PlayerResultRequest] = List(
      player("ponta", 1, 1),
      player("akane-mami", 2, 2),
      player("otaka", 3, 3),
      player("eu", 4, 4),
    )

    def confirmMatch(heldEventId: String): Json = confirmMatchWithNo(heldEventId, 1)

    def confirmMatchWithNo(heldEventId: String, matchNoInEvent: Int): Json =
      confirmMatchWithPlayers(heldEventId, matchNoInEvent, defaultPlayers)

    def confirmMatchWithPlayers(
        heldEventId: String,
        matchNoInEvent: Int,
        players: List[PlayerResultRequest],
    ): Json = ConfirmMatchRequest(
      matchDraftId = None,
      heldEventId = heldEventId,
      matchNoInEvent = matchNoInEvent,
      gameTitleId = "title_world",
      seasonMasterId = "season_2024_spring",
      ownerMemberId = "ponta",
      mapMasterId = "map_east",
      playedAt = "2024-01-01T20:00:00Z",
      draftIds = ConfirmMatchDraftIds(None, None, None),
      players = players,
    ).asJson
