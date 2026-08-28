package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object HeldEventsEndpoints:
  type GetInput = String

  final case class ListInput(
      searchQuery: Option[String],
      limit: Option[Int],
      page: Option[Int],
      pageSize: Option[Int],
  )

  private val listInput: EndpointInput[ListInput] = query[Option[String]]("q")
    .and(query[Option[Int]]("limit").description("1..100; defaults to 20."))
    .and(query[Option[Int]]("page").description("1-based page number; defaults to 1."))
    .and(query[Option[Int]]("pageSize").description("1..100; overrides limit when present."))
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
