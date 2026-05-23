package momo.api.http.modules

import java.nio.charset.StandardCharsets

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.MatchExportScope
import momo.api.endpoints.codec.ExportCodec
import momo.api.endpoints.{ExportEndpoints, ProblemDetails}
import momo.api.errors.AppError
import momo.api.http.EndpointSecurity
import momo.api.usecases.ExportMatches

object ExportModule:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.ExportModule")

  def routes[F[_]: Async](
      exportMatches: ExportMatches[F],
      rateLimiter: RateLimiter[F],
      allRateLimiter: RateLimiter[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(ExportEndpoints.matches.serverLogic {
    case (format, seasonMasterId, heldEventId, matchId, accountHeader) => security
        .authorizeRead(accountHeader) { member =>
          val decoded =
            for
              exportFormat <- ExportCodec.parseFormat(format)
              scope <- ExportCodec.parseScope(seasonMasterId, heldEventId, matchId)
            yield (exportFormat, scope)
          security.decode(decoded) { case (exportFormat, scope) =>
            selectedRateLimiter(scope, rateLimiter, allRateLimiter)
              .allow(rateLimitKey(scope, member.accountId.value)).flatMap {
                case false => exportRateLimited(member.accountId.value, scope)
                case true => exportMatches.run(exportFormat, scope)
                    .flatMap {
                      case Left(error) =>
                        logRejected(member.accountId.value, exportFormat.wire, scope, error) *>
                          security.toProblemF(error).map(Left(_))
                      case Right(file) =>
                        val bodyBytes = file.body.getBytes(StandardCharsets.UTF_8).length
                        val event = s"match_export_completed accountId=${member.accountId.value} " +
                          s"format=${exportFormat.wire} scope=${scope.filePart} " +
                          s"bodyBytes=${bodyBytes.toString}"
                        Async[F].delay(logger.info(event)) *>
                          Async[F]
                            .pure(Right((file.contentDisposition, file.contentType, file.body)))
                    }
              }
          }
        }
  })

  private def selectedRateLimiter[F[_]](
      scope: MatchExportScope,
      scoped: RateLimiter[F],
      all: RateLimiter[F],
  ): RateLimiter[F] = scope match
    case MatchExportScope.All => all
    case _ => scoped

  private def rateLimitKey(scope: MatchExportScope, accountId: String): String = scope match
    case MatchExportScope.All => s"export:all:$accountId"
    case _ => s"export:$accountId"

  private def exportRateLimited[F[_]: Async, A](
      accountId: String,
      scope: MatchExportScope,
  ): F[Either[ProblemDetails.ProblemResponse, A]] = Async[F].delay(logger.warn(
    s"match_export_rate_limited accountId=$accountId scope=${scope.filePart}"
  )) *> Async[F].pure(Left(
    ProblemDetails.from(AppError.TooManyRequests("Too many exports. Try again later."))
  ))

  private def logRejected[F[_]: Async](
      accountId: String,
      format: String,
      scope: MatchExportScope,
      error: AppError,
  ): F[Unit] = error match
    case _: AppError.PayloadTooLarge =>
      val detail = error.detail.replaceAll("\\s+", "_")
      Async[F]
        .delay(logger.warn(s"match_export_rejected accountId=$accountId format=$format scope=${scope
            .filePart} " + s"code=${error.code} detail=$detail"))
    case _ => Async[F].unit
