package momo.api.http.modules

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.SeriesComparisonEndpoints
import momo.api.endpoints.codec.SeriesComparisonCodec
import momo.api.http.{EndpointSecurity, HttpOperation}
import momo.api.usecases.{
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
    SeriesComparisonEndpoints.options.serverLogic { accountHeader =>
      security.authorizeRead(accountHeader) { member =>
        ReadRateLimit.enforce(
          readRateLimiter,
          member.accountId.value,
          HttpOperation.GetSeriesComparisonOptions,
        )(security.respond(getOptions.run)(identity))
      }
    },
    SeriesComparisonEndpoints.aggregate.serverLogic {
      case (gameTitleId, scopeKind, scopeId, seasonMasterId, mapMasterId, accountHeader) => security
          .authorizeRead(accountHeader) { member =>
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
          }
    },
    SeriesComparisonEndpoints.review.serverLogic {
      case (gameTitleId, seasonMasterId, mapMasterId, accountHeader) => security
          .authorizeRead(accountHeader) { member =>
            ReadRateLimit.enforce(
              readRateLimiter,
              member.accountId.value,
              HttpOperation.GetSeriesComparisonReview,
            ) {
              security.decode(
                SeriesComparisonCodec.parseReviewQuery(gameTitleId, seasonMasterId, mapMasterId)
              )(scope => security.respond(getReview.run(scope))(identity))
            }
          }
    },
    SeriesComparisonEndpoints.drilldown.serverLogic {
      case (gameTitleId, metricId, memberId, seasonMasterId, mapMasterId, accountHeader) =>
        security.authorizeRead(accountHeader) { member =>
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
        }
    },
  )
