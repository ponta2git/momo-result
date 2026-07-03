package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.generic.auto.*
import sttp.tapir.*
import sttp.tapir.json.circe.*
import sttp.tapir.server.ServerEndpoint

import momo.api.config.{AppConfig, AppEnv}
import momo.api.endpoints.{HealthEndpoints, HealthPaths}
import momo.api.http.{EndpointSecurity, SecuredEndpoint}

object HealthModule:
  def routes[F[_]: Async](
      config: AppConfig,
      details: F[HealthEndpoints.HealthDetailsResponse],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    HealthEndpoints.health
      .serverLogicSuccess(_ => Async[F].pure(HealthEndpoints.HealthResponse("ok"))),
  ) ++ detailsRoutes(config, details, security)

  private def detailsRoutes[F[_]: Async](
      config: AppConfig,
      details: F[HealthEndpoints.HealthDetailsResponse],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = config.appEnv match
    case AppEnv.Prod => List(
        SecuredEndpoint.read(security)
          .get
          .in(HealthPaths.Health / HealthPaths.Details)
          .out(jsonBody[HealthEndpoints.HealthDetailsResponse])
          .tag("health")
          .serverLogic(_ => _ => details.map(Right(_)))
      )
    case AppEnv.Dev | AppEnv.Test => List(
        HealthEndpoints.details.serverLogicSuccess(_ => details)
      )
