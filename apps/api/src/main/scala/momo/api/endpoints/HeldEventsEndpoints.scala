package momo.api.endpoints

import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.PublicEndpoint
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.*

object HeldEventsEndpoints:
  val list: PublicEndpoint[
    (Option[String], Option[Int], Option[String]),
    ErrorInfo,
    HeldEventListResponse,
    Any
  ] =
    endpoint.get
      .in("api" / "held-events")
      .in(query[Option[String]]("q"))
      .in(query[Option[Int]]("limit"))
      .in(header[Option[String]]("X-Dev-User"))
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[HeldEventListResponse])
      .tag("held-events")

  type CreateInput = (Option[String], Option[String], CreateHeldEventRequest)

  val create: PublicEndpoint[CreateInput, ErrorInfo, HeldEventResponse, Any] =
    endpoint.post
      .in("api" / "held-events")
      .in(header[Option[String]]("X-Dev-User"))
      .in(header[Option[String]]("X-CSRF-Token"))
      .in(jsonBody[CreateHeldEventRequest])
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[HeldEventResponse])
      .tag("held-events")
