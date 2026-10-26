package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

import momo.api.endpoints.AchievementApiSchemas.given

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
      mapMasterId: Option[String],
      from: Option[String],
      to: Option[String],
      q: Option[String],
      memberId: Option[String],
      record: Option[String],
      recordValue: Option[Int],
      recordRange: Option[String],
  )

  private val matchOnly = " Confirmed-match criterion; requires kind=match."

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
      "status_priority, updated_desc, held_desc, held_asc, or match_no_asc. held_desc and " +
        "held_asc order by held time, then match number ascending within the same held time."
    ))
    .and(query[Option[String]]("mapMasterId").description("Map master ID." + matchOnly))
    .and(query[Option[String]]("from").description(
      "Inclusive held date (YYYY-MM-DD, Asia/Tokyo); must not be after to." + matchOnly
    ))
    .and(query[Option[String]]("to").description(
      "Inclusive held date (YYYY-MM-DD, Asia/Tokyo)." + matchOnly
    ))
    .and(query[Option[String]]("q").description(
      "Case-insensitive literal substring of the match note; trimmed, at most 50 characters, " +
        "blank means absent." + matchOnly
    ))
    .and(query[Option[String]]("memberId").description(
      "Limits the record condition to this player; requires record. Without it any player matches."
    ))
    .and(query[Option[String]]("record").description(
      "destination, plus_station, minus_station, card_station, card_shop, suri_no_ginji, " +
        "total_assets, or revenue (万円); requires recordValue." + matchOnly
    ))
    .and(query[Option[Int]]("recordValue").description(
      "Compared value; requires record. Incident counts must be 0 or greater and a missing " +
        "count is 0."
    ))
    .and(query[Option[String]]("recordRange").description(
      "gte (default) or lte; requires record."
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

  val identity: CommonEndpoint.SecuredRead[String, MatchIdentityResponse] = endpoint
    .get
    .in("api" / "matches" / path[String]("matchId") / "identity")
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchIdentityResponse])
    .tag("matches")

  val getByPublicId: CommonEndpoint.SecuredRead[String, MatchDetailResponse] = endpoint
    .get
    .in("api" / "public" / "matches" / path[String]("publicId").description(
      "Canonical positive decimal string, from 1 through 9223372036854775807."
    ))
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
