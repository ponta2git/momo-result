package momo.api.endpoints

import sttp.tapir.{PublicEndpoint, *}

object OpenApiEndpoints:
  val yaml: PublicEndpoint[Unit, Unit, String, Any] = endpoint.get.in("openapi.yaml")
    .out(stringBody).tag("openapi")
