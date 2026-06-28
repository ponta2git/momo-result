package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object HeldEventsEndpoints:
  val list: CommonEndpoint.SecuredRead[
    (Option[String], Option[Int], Option[Int], Option[Int]),
    HeldEventListResponse,
  ] = endpoint
    .get
    .in("api" / "held-events")
    .securityIn(CommonEndpoint.accountHeader)
    .in(query[Option[String]]("q"))
    .in(query[Option[Int]]("limit").description("1..100; defaults to 20."))
    .in(query[Option[Int]]("page").description("1-based page number; defaults to 1."))
    .in(query[Option[Int]]("pageSize").description("1..100; overrides limit when present."))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventListResponse])
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
