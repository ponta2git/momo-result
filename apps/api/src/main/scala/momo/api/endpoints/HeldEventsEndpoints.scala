package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object HeldEventsEndpoints:
  type GetInput = String

  final case class ListInput(
      limit: Option[Int],
      page: Option[Int],
      pageSize: Option[Int],
      sort: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
      from: Option[String],
      to: Option[String],
      minMatchCount: Option[Int],
      q: Option[String],
      memberId: Option[String],
      metric: Option[String],
      metricValue: Option[String],
      metricRange: Option[String],
  )

  private val confirmedOnly = " Evaluated over the held event's confirmed matches only."

  private val listInput: EndpointInput[ListInput] = query[Option[Int]]("limit")
    .description("1..100; defaults to 20.")
    .and(query[Option[Int]]("page").description("1-based page number; defaults to 1."))
    .and(query[Option[Int]]("pageSize").description("1..100; overrides limit when present."))
    .and(query[Option[String]]("sort").description(
      "held_desc (default) or held_asc. Orders by held time, then held event ID, both in the " +
        "chosen direction."
    ))
    .and(query[Option[String]]("gameTitleId").description(
      "Game title ID; one confirmed match must also satisfy seasonMasterId and mapMasterId." +
        confirmedOnly
    ))
    .and(query[Option[String]]("seasonMasterId").description("Season master ID." + confirmedOnly))
    .and(query[Option[String]]("mapMasterId").description("Map master ID." + confirmedOnly))
    .and(query[Option[String]]("from").description(
      "Inclusive held date (YYYY-MM-DD, Asia/Tokyo); must not be after to."
    ))
    .and(query[Option[String]]("to").description("Inclusive held date (YYYY-MM-DD, Asia/Tokyo)."))
    .and(query[Option[Int]]("minMatchCount").description(
      "1 or greater; the held event has at least this many confirmed matches."
    ))
    .and(query[Option[String]]("q").description(
      "Case-insensitive literal substring of a match note; trimmed, at most 50 characters, " +
        "blank means absent. Items then carry noteMatch." + confirmedOnly
    ))
    .and(query[Option[String]]("memberId").description(
      "Limits the metric condition to this player; requires metric. Without it any player matches."
    ))
    .and(query[Option[String]]("metric").description(
      "average_rank, rank1_count, rank2_count, rank3_count, or rank4_count; requires " +
        "metricValue. Events without a confirmed match never satisfy it." + confirmedOnly
    ))
    .and(query[Option[String]]("metricValue").description(
      "Compared value; requires metric. average_rank: 1.00 to 4.00 with at most 2 decimal " +
        "places, compared with the average rounded to 2 decimals. Rank counts: integer 0 or greater."
    ))
    .and(query[Option[String]]("metricRange").description("gte (default) or lte; requires metric."))
    .mapTo[ListInput]

  val list: CommonEndpoint.SecuredRead[ListInput, HeldEventListResponse] = endpoint
    .get
    .in("api" / "held-events")
    .securityIn(CommonEndpoint.accountHeader)
    .in(listInput)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventListResponse])
    .tag("held-events")

  val get: CommonEndpoint.SecuredRead[GetInput, HeldEventDetailResponse] = endpoint
    .get
    .in("api" / "held-events" / path[String]("heldEventId"))
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventDetailResponse])
    .tag("held-events")

  val getByPublicId: CommonEndpoint.SecuredRead[String, HeldEventDetailResponse] = endpoint
    .get
    .in("api" / "public" / "held-events" / path[String]("publicId").description(
      "Canonical positive decimal string, from 1 through 9223372036854775807."
    ))
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventDetailResponse])
    .tag("held-events")

  val summary: CommonEndpoint.SecuredRead[GetInput, HeldEventSummaryResponse] = endpoint
    .get
    .in("api" / "held-events" / path[String]("heldEventId") / "summary")
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventSummaryResponse])
    .tag("held-events")

  type CreateInput = (Option[String], CreateHeldEventRequest)

  val create: CommonEndpoint.SecuredMutation[CreateInput, HeldEventResponse] = endpoint
    .post
    .in("api" / "held-events")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateHeldEventRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventResponse])
    .tag("held-events")

  type DeleteInput = (String, Option[String])

  val delete: CommonEndpoint.SecuredMutation[DeleteInput, DeleteHeldEventResponse] = endpoint
    .delete
    .in("api" / "held-events" / path[String]("heldEventId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[DeleteHeldEventResponse])
    .tag("held-events")
