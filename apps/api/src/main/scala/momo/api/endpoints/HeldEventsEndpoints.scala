package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.http.ProblemDetails.ErrorInfo

object HeldEventsEndpoints:
  val list: PublicEndpoint[
    (Option[String], Option[Int], Option[String]),
    ErrorInfo,
    HeldEventListResponse,
    Any,
  ] = endpoint
    .get
    .in("api" / "held-events")
    .in(query[Option[String]]("q"))
    .in(query[Option[Int]]("limit"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventListResponse])
    .tag("held-events")

  type CreateInput = (Option[String], Option[String], Option[String], CreateHeldEventRequest)

  val create: PublicEndpoint[CreateInput, ErrorInfo, HeldEventResponse, Any] = endpoint
    .post
    .in("api" / "held-events")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateHeldEventRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[HeldEventResponse])
    .tag("held-events")
