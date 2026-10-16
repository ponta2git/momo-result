package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.{SeriesPlayerRadarHistoryRequest, SeriesPlayerRadarPreviewRequest}
import momo.api.endpoints.*
import momo.api.endpoints.codec.{SeriesAnalysisCodec, SeriesPlayerRadarCodec}
import momo.api.errors.AppError
import momo.api.http.{HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.seriesanalysis.*

object SeriesPlayerRadarModule:
  final case class UseCases[F[_]](
      getHistory: GetSeriesPlayerRadarHistory[F],
      getState: GetSeriesPlayerRadarState[F],
      getPreview: GetSeriesPlayerRadarPreview[F],
      getOperation: GetSeriesPlayerRadarOperation[F],
      requestOperation: RequestSeriesPlayerRadarOperation[F],
  )

  def routes[F[_]: Async](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.operatorReadLogic(security, SeriesPlayerRadarEndpoints.history) {
        _ => input =>
          val decoded =
            for
              title <- input.gameTitleId.traverse(SeriesAnalysisCodec.gameTitleId)
              cursor <- input.cursor.traverse(SeriesPlayerRadarCodec.opaqueId("cursor", _))
              limit = input.limit.getOrElse(20)
              _ <- Either.cond(
                limit >= 1 && limit <= 50,
                (),
                AppError.ValidationFailed("limit must be between 1 and 50.")
              )
            yield SeriesPlayerRadarHistoryRequest(title, limit, cursor)
          execution.execute(
            decoded
          )(request => getHistory.list(request))(
            _.payload
          )
      },
      SecuredEndpoint.operatorReadLogic(security, SeriesPlayerRadarEndpoints.revision) {
        _ => id =>
          execution.execute(
            SeriesPlayerRadarCodec.opaqueId("revisionId", id)
          )(revision => getHistory.detail(revision))(
            _.payload
          )
      },
      SecuredEndpoint.operatorReadLogic(security, SeriesPlayerRadarEndpoints.state) {
        _ => rawTitle =>
          execution.execute(
            SeriesAnalysisCodec.gameTitleId(rawTitle)
          )(title => getState.run(title))(
            _.payload
          )
      },
      SecuredEndpoint.operatorReadLogic(security, SeriesPlayerRadarEndpoints.preview) {
        _ => input =>
          val decoded =
            for
              title <- SeriesAnalysisCodec.gameTitleId(input.gameTitleId)
              preview <- SeriesPlayerRadarCodec.opaqueId("previewId", input.previewId)
              scope <- SeriesAnalysisCodec.scope(input.seasonMasterId, input.mapMasterId)
            yield SeriesPlayerRadarPreviewRequest(title, preview, scope)
          execution.execute(
            decoded
          )(request => getPreview.run(request))(
            _.payload
          )
      },
      SecuredEndpoint.operatorReadLogic(security, SeriesPlayerRadarEndpoints.operation) {
        _ => input =>
          val decoded =
            for
              title <- SeriesAnalysisCodec.gameTitleId(input.gameTitleId)
              operation <- SeriesPlayerRadarCodec.opaqueId("operationId", input.operationId)
            yield (title, operation)
          execution.execute(
            decoded
          ) { case (title, operation) =>
            getOperation.run(
              title,
              operation
            )
          }(
            SeriesPlayerRadarOperationResponse.from
          )
      },
      SecuredEndpoint.operatorMutationLogic(security, SeriesPlayerRadarEndpoints.requestOperation) {
        account => input =>
          val (idempotencyKey, request) = input
          idempotencyKey match
            case None => security.toProblemF(AppError.ValidationFailed(
                "Idempotency-Key is required."
              )).map(Left(_))
            case Some(key) => security.decode(SeriesPlayerRadarCodec.command(request)) { command =>
                execution.replay(
                  HttpOperation.RequestRadarOperation,
                  Some(key),
                  account,
                  request,
                )(
                  security.respond(requestOperation.run(command, account.accountId, key))(
                    SeriesPlayerRadarOperationResponse.from
                  )
                )
              }
      },
    )
