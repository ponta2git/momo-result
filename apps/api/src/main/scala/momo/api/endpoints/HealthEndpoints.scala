package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

object HealthEndpoints:
  final case class HealthResponse(status: String) derives Codec.AsObject

  val health: PublicEndpoint[Unit, Unit, HealthResponse, Any] = endpoint
    .get
    .in("healthz")
    .out(jsonBody[HealthResponse])
    .tag("health")
