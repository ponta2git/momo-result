package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.ids.{HeldEventId, MatchId, SeasonMasterId}
import momo.api.endpoints.ExportEndpoints
import momo.api.endpoints.codec.{BoundaryId, ExportCodec}
import momo.api.errors.AppError
import momo.api.http.EndpointSecurity
import momo.api.usecases.ExportMatches

object ExportModule:
  def routes[F[_]: Async](
      exportMatches: ExportMatches[F],
      rateLimiter: RateLimiter[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(ExportEndpoints.matches.serverLogic {
    case (format, seasonMasterId, heldEventId, matchId, accountHeader) => security
        .authorizeRead(accountHeader) { member =>
          rateLimiter.allow(s"export:${member.accountId.value}").flatMap {
            case false => Async[F].pure(Left(
                security.toProblem(AppError.TooManyRequests("Too many exports. Try again later."))
              ))
            case true =>
              val decoded =
                for
                  exportFormat <- ExportCodec.parseFormat(format)
                  season <- BoundaryId
                    .optional("seasonMasterId", seasonMasterId)(SeasonMasterId.fromString)
                  event <- BoundaryId.optional("heldEventId", heldEventId)(HeldEventId.fromString)
                  matchValue <- BoundaryId.optional("matchId", matchId)(MatchId.fromString)
                yield (exportFormat, season, event, matchValue)
              security.decode(decoded) { case (exportFormat, season, event, matchValue) =>
                exportMatches.run(exportFormat, season, event, matchValue).map(
                  _.leftMap(security.toProblem)
                    .map(file => (file.contentDisposition, file.contentType, file.body))
                )
              }
          }
        }
  })
