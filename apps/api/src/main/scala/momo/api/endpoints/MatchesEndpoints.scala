package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object MatchesEndpoints:
  type ConfirmInput = (Option[String], ConfirmMatchRequest)

  val confirm: CommonEndpoint.SecuredMutation[ConfirmInput, ConfirmMatchResponse] = endpoint
    .post
    .in("api" / "matches")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[ConfirmMatchRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[ConfirmMatchResponse])
    .tag("matches")

  type ListInput = (
      Option[String],
      Option[String],
      Option[String],
      Option[String],
      Option[String],
      Option[Int],
      Option[String],
      Option[String],
  )

  val list: CommonEndpoint.SecuredRead[ListInput, MatchListResponse] = endpoint
    .get
    .in("api" / "matches")
    .securityIn(CommonEndpoint.accountHeader)
    .in(query[Option[String]]("heldEventId"))
    .in(query[Option[String]]("gameTitleId"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("status"))
    .in(query[Option[String]]("kind"))
    .in(query[Option[Int]]("pageSize").description("1..200; defaults to 100."))
    .in(query[Option[String]]("cursor").description(
      "Opaque cursor returned by this endpoint. Omit it to refresh the count snapshot."
    ))
    .in(query[Option[String]]("sort").description(
      "status_priority, updated_desc, held_desc, held_asc, or match_no_asc."
    ))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchListResponse])
    .tag("matches")

  type SummaryInput = (Option[String], Option[String], Option[String])

  val summary: CommonEndpoint.SecuredRead[SummaryInput, MatchListSummaryResponse] =
    endpoint
      .get
      .in("api" / "matches" / "summary")
      .securityIn(CommonEndpoint.accountHeader)
      .in(query[Option[String]]("heldEventId"))
      .in(query[Option[String]]("gameTitleId"))
      .in(query[Option[String]]("seasonMasterId"))
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[MatchListSummaryResponse])
      .tag("matches")

  val get: CommonEndpoint.SecuredRead[String, MatchDetailResponse] =
    endpoint
      .get
      .in("api" / "matches" / path[String]("matchId"))
      .securityIn(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[MatchDetailResponse])
      .tag("matches")

  type UpdateInput = (String, Option[String], UpdateMatchRequest)

  val update: CommonEndpoint.SecuredMutation[UpdateInput, MatchDetailResponse] = endpoint
    .put
    .in("api" / "matches" / path[String]("matchId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateMatchRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDetailResponse])
    .tag("matches")

  type DeleteInput = (String, Option[String])

  val delete: CommonEndpoint.SecuredMutation[DeleteInput, DeleteMatchResponse] = endpoint
    .delete
    .in("api" / "matches" / path[String]("matchId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMatchResponse])
    .tag("matches")
