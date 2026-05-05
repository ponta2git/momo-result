package momo.api.http.modules

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.endpoints.{HealthEndpoints, OpenApiEndpoints}
import momo.api.openapi.OpenApiGenerator

object HealthModule:
  def routes[F[_]: Async]: List[ServerEndpoint[Any, F]] = List(
    HealthEndpoints.health
      .serverLogicSuccess(_ => Async[F].pure(HealthEndpoints.HealthResponse("ok"))),
    OpenApiEndpoints.yaml.serverLogicSuccess(_ => Async[F].pure(OpenApiGenerator.yaml)),
  )
