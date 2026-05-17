package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.endpoints.ExportEndpoints
import momo.api.endpoints.codec.ExportCodec
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
                  scope <- ExportCodec.parseScope(seasonMasterId, heldEventId, matchId)
                yield (exportFormat, scope)
              security.decode(decoded) { case (exportFormat, scope) =>
                exportMatches.run(exportFormat, scope).flatMap {
                  case Left(error) => security.toProblemF(error).map(Left(_))
                  case Right(file) => Async[F]
                      .pure(Right((file.contentDisposition, file.contentType, file.body)))
                }
              }
          }
        }
  })
