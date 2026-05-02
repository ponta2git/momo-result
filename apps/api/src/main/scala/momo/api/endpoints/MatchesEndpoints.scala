package momo.api.endpoints

import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.{PublicEndpoint, *}
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object MatchesEndpoints:
  type ConfirmInput = (Option[String], Option[String], ConfirmMatchRequest)

  val confirm: PublicEndpoint[ConfirmInput, ErrorInfo, ConfirmMatchResponse, Any] = endpoint
    .post
    .in("api" / "matches")
    .in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token"))
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

  val list: PublicEndpoint[ListInput, ErrorInfo, MatchListResponse, Any] = endpoint
    .get
    .in("api" / "matches")
    .in(query[Option[String]]("heldEventId"))
    .in(query[Option[String]]("gameTitleId"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("status"))
    .in(query[Option[String]]("kind"))
    .in(query[Option[Int]]("limit"))
    .in(header[Option[String]]("X-Dev-User"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchListResponse])
    .tag("matches")

  val get: PublicEndpoint[(String, Option[String]), ErrorInfo, MatchDetailResponse, Any] = endpoint
    .get
    .in("api" / "matches" / path[String]("matchId"))
    .in(header[Option[String]]("X-Dev-User"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDetailResponse])
    .tag("matches")

  type UpdateInput = (String, Option[String], Option[String], UpdateMatchRequest)

  val update: PublicEndpoint[UpdateInput, ErrorInfo, MatchDetailResponse, Any] = endpoint
    .put
    .in("api" / "matches" / path[String]("matchId"))
    .in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token"))
    .in(jsonBody[UpdateMatchRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDetailResponse])
    .tag("matches")

  type DeleteInput = (String, Option[String], Option[String])

  val delete: PublicEndpoint[DeleteInput, ErrorInfo, DeleteMatchResponse, Any] = endpoint
    .delete
    .in("api" / "matches" / path[String]("matchId"))
    .in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteMatchResponse])
    .tag("matches")
