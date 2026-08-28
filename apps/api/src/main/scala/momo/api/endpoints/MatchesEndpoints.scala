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

  final case class ListInput(
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      status: Option[String],
      kind: Option[String],
      pageSize: Option[Int],
      cursor: Option[String],
      sort: Option[String],
  )

  private val listInput: EndpointInput[ListInput] = query[Option[String]]("heldEventId")
    .and(query[Option[String]]("gameTitleId"))
    .and(query[Option[String]]("seasonMasterId"))
    .and(query[Option[String]]("status"))
    .and(query[Option[String]]("kind"))
    .and(query[Option[Int]]("pageSize").description("1..200; defaults to 100."))
    .and(query[Option[String]]("cursor").description(
      "Opaque cursor returned by this endpoint. Omit it to refresh the count snapshot."
    ))
    .and(query[Option[String]]("sort").description(
      "status_priority, updated_desc, held_desc, held_asc, or match_no_asc."
    ))
    .mapTo[ListInput]

  val list: CommonEndpoint.SecuredRead[ListInput, MatchListResponse] = endpoint
    .get
    .in("api" / "matches")
    .securityIn(CommonEndpoint.accountHeader)
    .in(listInput)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchListResponse])
    .tag("matches")

  final case class SummaryInput(
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
  )

  private val summaryInput: EndpointInput[SummaryInput] = query[Option[String]]("heldEventId")
    .and(query[Option[String]]("gameTitleId"))
    .and(query[Option[String]]("seasonMasterId"))
    .mapTo[SummaryInput]

  val summary: CommonEndpoint.SecuredRead[SummaryInput, MatchListSummaryResponse] =
    endpoint
      .get
      .in("api" / "matches" / "summary")
      .securityIn(CommonEndpoint.accountHeader)
      .in(summaryInput)
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

  val update: CommonEndpoint.SecuredMutation[UpdateInput, UpdateMatchResponse] = endpoint
    .put
    .in("api" / "matches" / path[String]("matchId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateMatchRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[UpdateMatchResponse])
    .tag("matches")

  type ReplaceNoteInput = (String, Option[String], ReplaceMatchNoteRequest)

  val replaceNote: CommonEndpoint.SecuredMutation[ReplaceNoteInput, ReplaceMatchNoteResponse] =
    endpoint
      .put
      .in("api" / "matches" / path[String]("matchId") / "note")
      .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
      .in(CommonEndpoint.idempotencyKeyHeader)
      .in(jsonBody[ReplaceMatchNoteRequest])
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[ReplaceMatchNoteResponse])
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
