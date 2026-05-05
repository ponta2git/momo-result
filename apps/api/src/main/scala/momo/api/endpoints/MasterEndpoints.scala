package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.http.ProblemDetails.ErrorInfo

object GameTitlesEndpoints:
  val list: PublicEndpoint[Option[String], ErrorInfo, GameTitleListResponse, Any] = endpoint
    .get
    .in("api" / "game-titles")
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[GameTitleListResponse])
    .tag("masters")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateGameTitleRequest),
    ErrorInfo,
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
  val list
      : PublicEndpoint[(Option[String], Option[String]), ErrorInfo, MapMasterListResponse, Any] =
    endpoint
      .get
      .in("api" / "map-masters")
      .in(query[Option[String]]("gameTitleId"))
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[MapMasterListResponse])
      .tag("masters")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateMapMasterRequest),
    ErrorInfo,
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
  val list
      : PublicEndpoint[(Option[String], Option[String]), ErrorInfo, SeasonMasterListResponse, Any] =
    endpoint
      .get
      .in("api" / "season-masters")
      .in(query[Option[String]]("gameTitleId"))
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[SeasonMasterListResponse])
      .tag("masters")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateSeasonMasterRequest),
    ErrorInfo,
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
  val list: PublicEndpoint[Option[String], ErrorInfo, IncidentMasterListResponse, Any] = endpoint
    .get
    .in("api" / "incident-masters")
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[IncidentMasterListResponse])
    .tag("masters")
