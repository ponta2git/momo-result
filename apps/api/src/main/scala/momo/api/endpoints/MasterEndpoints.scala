package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object GameTitlesEndpoints:
  val list: PublicEndpoint[Option[String], ProblemResponse, GameTitleListResponse, Any] = endpoint
    .get
    .in("api" / "game-titles")
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[GameTitleListResponse])
    .tag("masters")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateGameTitleRequest),
    ProblemResponse,
    GameTitleResponse,
    Any,
  ] = endpoint
    .post
    .in("api" / "game-titles")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateGameTitleRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[GameTitleResponse])
    .tag("masters")

object MapMastersEndpoints:
  val list: PublicEndpoint[
    (Option[String], Option[String]),
    ProblemResponse,
    MapMasterListResponse,
    Any,
  ] = endpoint
    .get
    .in("api" / "map-masters")
    .in(query[Option[String]]("gameTitleId"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MapMasterListResponse])
    .tag("masters")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateMapMasterRequest),
    ProblemResponse,
    MapMasterResponse,
    Any,
  ] = endpoint
    .post
    .in("api" / "map-masters")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateMapMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MapMasterResponse])
    .tag("masters")

object SeasonMastersEndpoints:
  val list: PublicEndpoint[
    (Option[String], Option[String]),
    ProblemResponse,
    SeasonMasterListResponse,
    Any,
  ] = endpoint
    .get
    .in("api" / "season-masters")
    .in(query[Option[String]]("gameTitleId"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeasonMasterListResponse])
    .tag("masters")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateSeasonMasterRequest),
    ProblemResponse,
    SeasonMasterResponse,
    Any,
  ] = endpoint
    .post
    .in("api" / "season-masters")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateSeasonMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeasonMasterResponse])
    .tag("masters")

object IncidentMastersEndpoints:
  val list: PublicEndpoint[Option[String], ProblemResponse, IncidentMasterListResponse, Any] =
    endpoint
      .get
      .in("api" / "incident-masters")
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[IncidentMasterListResponse])
      .tag("masters")
