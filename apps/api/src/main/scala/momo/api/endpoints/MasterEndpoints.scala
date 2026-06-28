package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object GameTitlesEndpoints:
  val list: CommonEndpoint.SecuredRead[Unit, GameTitleListResponse] = endpoint
    .get
    .in("api" / "game-titles")
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[GameTitleListResponse])
    .tag("masters")

  val create: CommonEndpoint.SecuredMutation[
    (Option[String], CreateGameTitleRequest),
    GameTitleResponse,
  ] = endpoint
    .post
    .in("api" / "game-titles")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateGameTitleRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[GameTitleResponse])
    .tag("masters")

  val update: CommonEndpoint.SecuredMutation[
    (String, Option[String], UpdateGameTitleRequest),
    GameTitleResponse,
  ] = endpoint
    .patch
    .in("api" / "game-titles" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateGameTitleRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[GameTitleResponse])
    .tag("masters")

  val delete: CommonEndpoint.SecuredMutation[
    (String, Option[String]),
    DeleteMasterResponse,
  ] = endpoint
    .delete
    .in("api" / "game-titles" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
    .tag("masters")

object MapMastersEndpoints:
  val list: CommonEndpoint.SecuredRead[
    Option[String],
    MapMasterListResponse,
  ] = endpoint
    .get
    .in("api" / "map-masters")
    .securityIn(CommonEndpoint.accountHeader)
    .in(query[Option[String]]("gameTitleId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MapMasterListResponse])
    .tag("masters")

  val create: CommonEndpoint.SecuredMutation[
    (Option[String], CreateMapMasterRequest),
    MapMasterResponse,
  ] = endpoint
    .post
    .in("api" / "map-masters")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateMapMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MapMasterResponse])
    .tag("masters")

  val update: CommonEndpoint.SecuredMutation[
    (String, Option[String], UpdateMapMasterRequest),
    MapMasterResponse,
  ] = endpoint
    .patch
    .in("api" / "map-masters" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateMapMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MapMasterResponse])
    .tag("masters")

  val delete: CommonEndpoint.SecuredMutation[
    (String, Option[String]),
    DeleteMasterResponse,
  ] = endpoint
    .delete
    .in("api" / "map-masters" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
    .tag("masters")

object SeasonMastersEndpoints:
  val list: CommonEndpoint.SecuredRead[
    Option[String],
    SeasonMasterListResponse,
  ] = endpoint
    .get
    .in("api" / "season-masters")
    .securityIn(CommonEndpoint.accountHeader)
    .in(query[Option[String]]("gameTitleId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeasonMasterListResponse])
    .tag("masters")

  val create: CommonEndpoint.SecuredMutation[
    (Option[String], CreateSeasonMasterRequest),
    SeasonMasterResponse,
  ] = endpoint
    .post
    .in("api" / "season-masters")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateSeasonMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeasonMasterResponse])
    .tag("masters")

  val update: CommonEndpoint.SecuredMutation[
    (String, Option[String], UpdateSeasonMasterRequest),
    SeasonMasterResponse,
  ] = endpoint
    .patch
    .in("api" / "season-masters" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateSeasonMasterRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[SeasonMasterResponse])
    .tag("masters")

  val delete: CommonEndpoint.SecuredMutation[
    (String, Option[String]),
    DeleteMasterResponse,
  ] = endpoint
    .delete
    .in("api" / "season-masters" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
    .tag("masters")

object IncidentMastersEndpoints:
  val list: CommonEndpoint.SecuredRead[Unit, IncidentMasterListResponse] =
    endpoint
      .get
      .in("api" / "incident-masters")
      .securityIn(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[IncidentMasterListResponse])
      .tag("masters")

object MemberAliasesEndpoints:
  val list: CommonEndpoint.SecuredRead[
    Option[String],
    MemberAliasListResponse,
  ] = endpoint
    .get
    .in("api" / "member-aliases")
    .securityIn(CommonEndpoint.accountHeader)
    .in(query[Option[String]]("memberId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MemberAliasListResponse])
    .tag("masters")

  val create: CommonEndpoint.SecuredMutation[
    (Option[String], CreateMemberAliasRequest),
    MemberAliasResponse,
  ] = endpoint
    .post
    .in("api" / "member-aliases")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateMemberAliasRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MemberAliasResponse])
    .tag("masters")

  val update: CommonEndpoint.SecuredMutation[
    (String, Option[String], UpdateMemberAliasRequest),
    MemberAliasResponse,
  ] = endpoint
    .patch
    .in("api" / "member-aliases" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateMemberAliasRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MemberAliasResponse])
    .tag("masters")

  val delete: CommonEndpoint.SecuredMutation[
    (String, Option[String]),
    DeleteMasterResponse,
  ] = endpoint
    .delete
    .in("api" / "member-aliases" / path[String]("id"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMasterResponse])
    .tag("masters")
