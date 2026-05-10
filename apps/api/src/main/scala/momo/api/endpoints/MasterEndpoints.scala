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

  val update: PublicEndpoint[
    (String, Option[String], Option[String], UpdateGameTitleRequest),
    ProblemResponse,
    GameTitleResponse,
    Any,
  ] = endpoint
    .patch
    .in("api" / "game-titles" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(jsonBody[UpdateGameTitleRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[GameTitleResponse])
    .tag("masters")

  val delete: PublicEndpoint[
    (String, Option[String], Option[String]),
    ProblemResponse,
    DeleteMasterResponse,
    Any,
  ] = endpoint
    .delete
    .in("api" / "game-titles" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
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

  val update: PublicEndpoint[
    (String, Option[String], Option[String], UpdateMapMasterRequest),
    ProblemResponse,
    MapMasterResponse,
    Any,
  ] = endpoint
    .patch
    .in("api" / "map-masters" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(jsonBody[UpdateMapMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MapMasterResponse])
    .tag("masters")

  val delete: PublicEndpoint[
    (String, Option[String], Option[String]),
    ProblemResponse,
    DeleteMasterResponse,
    Any,
  ] = endpoint
    .delete
    .in("api" / "map-masters" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
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

  val update: PublicEndpoint[
    (String, Option[String], Option[String], UpdateSeasonMasterRequest),
    ProblemResponse,
    SeasonMasterResponse,
    Any,
  ] = endpoint
    .patch
    .in("api" / "season-masters" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(jsonBody[UpdateSeasonMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeasonMasterResponse])
    .tag("masters")

  val delete: PublicEndpoint[
    (String, Option[String], Option[String]),
    ProblemResponse,
    DeleteMasterResponse,
    Any,
  ] = endpoint
    .delete
    .in("api" / "season-masters" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
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

object MemberAliasesEndpoints:
  val list: PublicEndpoint[
    (Option[String], Option[String]),
    ProblemResponse,
    MemberAliasListResponse,
    Any,
  ] = endpoint
    .get
    .in("api" / "member-aliases")
    .in(query[Option[String]]("memberId"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MemberAliasListResponse])
    .tag("masters")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateMemberAliasRequest),
    ProblemResponse,
    MemberAliasResponse,
    Any,
  ] = endpoint
    .post
    .in("api" / "member-aliases")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateMemberAliasRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MemberAliasResponse])
    .tag("masters")

  val update: PublicEndpoint[
    (String, Option[String], Option[String], UpdateMemberAliasRequest),
    ProblemResponse,
    MemberAliasResponse,
    Any,
  ] = endpoint
    .patch
    .in("api" / "member-aliases" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(jsonBody[UpdateMemberAliasRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MemberAliasResponse])
    .tag("masters")

  val delete: PublicEndpoint[
    (String, Option[String], Option[String]),
    ProblemResponse,
    DeleteMasterResponse,
    Any,
  ] = endpoint
    .delete
    .in("api" / "member-aliases" / path[String]("id"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
    .tag("masters")
