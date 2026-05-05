package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object MatchesEndpoints:
  type ConfirmInput = (Option[String], Option[String], Option[String], ConfirmMatchRequest)

  val confirm: PublicEndpoint[ConfirmInput, ProblemResponse, ConfirmMatchResponse, Any] = endpoint
    .post
    .in("api" / "matches")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
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
  )

  val list: PublicEndpoint[ListInput, ProblemResponse, MatchListResponse, Any] = endpoint
    .get
    .in("api" / "matches")
    .in(query[Option[String]]("heldEventId"))
    .in(query[Option[String]]("gameTitleId"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("status"))
    .in(query[Option[String]]("kind"))
    .in(query[Option[Int]]("limit"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchListResponse])
    .tag("matches")

  val get: PublicEndpoint[(String, Option[String]), ProblemResponse, MatchDetailResponse, Any] =
    endpoint
      .get
      .in("api" / "matches" / path[String]("matchId"))
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[MatchDetailResponse])
      .tag("matches")

  type UpdateInput = (String, Option[String], Option[String], UpdateMatchRequest)

  val update: PublicEndpoint[UpdateInput, ProblemResponse, MatchDetailResponse, Any] = endpoint
    .put
    .in("api" / "matches" / path[String]("matchId"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(jsonBody[UpdateMatchRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDetailResponse])
    .tag("matches")

  type DeleteInput = (String, Option[String], Option[String])

  val delete: PublicEndpoint[DeleteInput, ProblemResponse, DeleteMatchResponse, Any] = endpoint
    .delete
    .in("api" / "matches" / path[String]("matchId"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMatchResponse])
    .tag("matches")
