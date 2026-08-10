package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.SeriesComparisonEndpoints
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, HttpOperation, SecuredEndpoint}

/** Authenticated tombstones for the removed synchronous Scala analysis surface. */
object AnalyticsModule:
  def routes[F[_]: Async](
      readRateLimiter: RateLimiter[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.options) { member => _ =>
      reject(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesComparisonOptions,
        security
      )
    },
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.aggregate) { member => _ =>
      reject(readRateLimiter, member.accountId.value, HttpOperation.GetSeriesComparison, security)
    },
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.review) { member => _ =>
      reject(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesComparisonReview,
        security,
      )
    },
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.drilldown) { member => _ =>
      reject(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesComparisonDrilldown,
        security,
      )
    },
  )

  private def reject[F[_]: Async](
      limiter: RateLimiter[F],
      accountId: String,
      operation: String,
      security: EndpointSecurity[F],
  ) = ReadRateLimit.enforce(limiter, accountId, operation)(
    security.toProblemF(AppError.AnalysisClientUpgradeRequired()).map(_.asLeft[Unit])
  )
