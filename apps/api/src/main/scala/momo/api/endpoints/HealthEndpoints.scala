package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

object HealthEndpoints:
  final case class HealthResponse(status: String) derives Codec.AsObject
  final case class HealthDetailsResponse(
      status: String,
      database: String,
      redis: String,
      ocrAdmission: String,
  ) derives Codec.AsObject

  val health: PublicEndpoint[Unit, Unit, HealthResponse, Any] = endpoint
    .get
    .in(HealthPaths.Health)
    .out(jsonBody[HealthResponse])
    .tag("health")

  val details: PublicEndpoint[Unit, Unit, HealthDetailsResponse, Any] = endpoint
    .get
    .in(HealthPaths.Health / HealthPaths.Details)
    .out(jsonBody[HealthDetailsResponse])
    .tag("health")
