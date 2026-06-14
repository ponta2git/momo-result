package momo.api.http.modules

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.SeriesComparisonEndpoints
import momo.api.endpoints.codec.SeriesComparisonCodec
import momo.api.http.{EndpointSecurity, HttpOperation}
import momo.api.usecases.{GetSeriesComparison, GetSeriesComparisonOptions}

object AnalyticsModule:
  def routes[F[_]: Async](
      getOptions: GetSeriesComparisonOptions[F],
      getComparison: GetSeriesComparison[F],
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
  )
