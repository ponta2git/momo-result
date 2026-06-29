package momo.api.http.modules

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.SeriesComparisonEndpoints
import momo.api.endpoints.codec.SeriesComparisonCodec
import momo.api.http.{EndpointSecurity, HttpOperation, SecuredEndpoint}
import momo.api.usecases.seriescomparison.{
  GetSeriesComparison,
  GetSeriesComparisonDrilldown,
  GetSeriesComparisonOptions,
  GetSeriesComparisonReview
}

object AnalyticsModule:
  def routes[F[_]: Async](
      getOptions: GetSeriesComparisonOptions[F],
      getComparison: GetSeriesComparison[F],
      getReview: GetSeriesComparisonReview[F],
      getDrilldown: GetSeriesComparisonDrilldown[F],
      readRateLimiter: RateLimiter[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.options) { member => _ =>
      ReadRateLimit.enforce(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesComparisonOptions,
      )(security.respond(getOptions.run)(identity))
    },
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.aggregate) { member => input =>
      val (gameTitleId, scopeKind, scopeId, seasonMasterId, mapMasterId) = input
      ReadRateLimit
        .enforce(readRateLimiter, member.accountId.value, HttpOperation.GetSeriesComparison) {
          security.decode(SeriesComparisonCodec.parseAggregateQuery(
            gameTitleId,
            scopeKind,
            scopeId,
            seasonMasterId,
            mapMasterId,
          ))(scope => security.respond(getComparison.run(scope))(identity))
        }
    },
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.review) { member => input =>
      val (gameTitleId, seasonMasterId, mapMasterId) = input
      ReadRateLimit.enforce(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesComparisonReview,
      ) {
        security.decode(
          SeriesComparisonCodec.parseReviewQuery(gameTitleId, seasonMasterId, mapMasterId)
        )(scope => security.respond(getReview.run(scope))(identity))
      }
    },
    SecuredEndpoint.readLogic(security, SeriesComparisonEndpoints.drilldown) { member => input =>
      val (gameTitleId, metricId, memberId, seasonMasterId, mapMasterId) = input
      ReadRateLimit.enforce(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesComparisonDrilldown,
      ) {
        security.decode(
          SeriesComparisonCodec.parseDrilldownQuery(
            gameTitleId,
            metricId,
            memberId,
            seasonMasterId,
            mapMasterId,
          )
        ) { case (scope, parsedMetricId, parsedMemberId) =>
          security.respond(getDrilldown.run(scope, parsedMetricId, parsedMemberId))(identity)
        }
      }
    },
  )
