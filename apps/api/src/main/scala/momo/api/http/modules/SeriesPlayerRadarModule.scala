package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.SeriesPlayerRadarPreviewRequest
import momo.api.endpoints.*
import momo.api.endpoints.codec.{SeriesAnalysisCodec, SeriesPlayerRadarCodec}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
import momo.api.usecases.seriesanalysis.*

object SeriesPlayerRadarModule:
  def routes[F[_]: Async](
      getState: GetSeriesPlayerRadarState[F],
      getPreview: GetSeriesPlayerRadarPreview[F],
      getOperation: GetSeriesPlayerRadarOperation[F],
      requestOperation: RequestSeriesPlayerRadarOperation[F],
      readRateLimiter: RateLimiter[F],
      idempotencyGuard: IdempotencyReplay.Guard[F],
      now: F[java.time.Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.adminReadLogic(security, SeriesPlayerRadarEndpoints.state) {
      account => rawTitle =>
        ReadRateLimit.enforce(
          readRateLimiter,
          account.accountId.value,
          HttpOperation.GetRadarState
        )(
          security.decode(SeriesAnalysisCodec.gameTitleId(rawTitle))(title =>
            security.respond(getState.run(title))(_.payload)
          )
        )
    },
    SecuredEndpoint.adminReadLogic(security, SeriesPlayerRadarEndpoints.preview) {
      account => input =>
        val decoded =
          for
            title <- SeriesAnalysisCodec.gameTitleId(input.gameTitleId)
            preview <- SeriesPlayerRadarCodec.opaqueId("previewId", input.previewId)
            scope <- SeriesAnalysisCodec.scope(input.seasonMasterId, input.mapMasterId)
          yield SeriesPlayerRadarPreviewRequest(title, preview, scope)
        ReadRateLimit.enforce(
          readRateLimiter,
          account.accountId.value,
          HttpOperation.GetRadarPreview
        )(
          security.decode(decoded)(request => security.respond(getPreview.run(request))(_.payload))
        )
    },
    SecuredEndpoint.adminReadLogic(security, SeriesPlayerRadarEndpoints.operation) {
      account => input =>
        val decoded =
          for
            title <- SeriesAnalysisCodec.gameTitleId(input.gameTitleId)
            operation <- SeriesPlayerRadarCodec.opaqueId("operationId", input.operationId)
          yield (title, operation)
        ReadRateLimit.enforce(
          readRateLimiter,
          account.accountId.value,
          HttpOperation.GetRadarOperation
        )(
          security.decode(decoded) { case (title, operation) =>
            security.respond(getOperation.run(
              title,
              operation
            ))(SeriesPlayerRadarOperationResponse.from)
          }
        )
    },
    SecuredEndpoint.adminMutationLogic(security, SeriesPlayerRadarEndpoints.requestOperation) {
      account => input =>
        val (idempotencyKey, request) = input
        idempotencyKey match
          case None => security.toProblemF(AppError.ValidationFailed(
              "Idempotency-Key is required."
            )).map(Left(_))
          case Some(key) => security.decode(SeriesPlayerRadarCodec.command(request)) { command =>
              IdempotencyReplay.wrap(
                idempotencyGuard,
                Some(key),
                account,
                HttpOperation.RequestRadarOperation,
                request,
                now,
                security.respond(requestOperation.run(command, account.accountId, key))(
                  SeriesPlayerRadarOperationResponse.from
                ),
              )
            }
    },
  )
