package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkProjection,
  SeriesAnalysisScopeStatusRequest
}
import momo.api.endpoints.*
import momo.api.endpoints.codec.{SeriesAnalysisCodec, SeriesPlayerRadarCodec}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.seriesanalysis.*

object SeriesAnalysisModule:
  final case class UseCases[F[_]](
      getOptions: GetSeriesAnalysisOptions[F],
      getStatus: GetSeriesAnalysisStatus[F],
      getChunk: GetSeriesAnalysisChunk[F],
      getAdminOverview: GetSeriesAnalysisAdminOverview[F],
      requestRecalculation: RequestSeriesAnalysisRecalculation[F],
  )

  def routes[F[_]: Async](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution

    def scoped(
        endpoint: CommonEndpoint.SecuredRead[
          SeriesAnalysisEndpoints.ScopedArtifactInput,
          Array[Byte]
        ],
        kind: SeriesAnalysisChunkKind,
    ): ServerEndpoint[Any, F] = SecuredEndpoint.readLogic(security, endpoint) { _ => input =>
      execution.execute(SeriesAnalysisCodec.chunk(
        kind,
        input.gameTitleId,
        input.artifactId,
        input.seasonMasterId,
        input.mapMasterId,
        None,
        None,
        None
      ))(getChunk.run)(_.payload)
    }

    List(
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.achievements) { _ =>
        { case (title, artifact) =>
          execution.execute(SeriesAnalysisCodec.chunk(
            SeriesAnalysisChunkKind.Achievements,
            title,
            artifact,
            None,
            None,
            None,
            None,
            None
          ))(getChunk.run)(_.payload)
        }
      },
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.options) { _ => _ =>
        security.respond(getOptions.run)(SeriesAnalysisOptionsResponse.from)
      },
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.status) { _ => rawTitleId =>
        execution.execute(
          SeriesAnalysisCodec.gameTitleId(rawTitleId)
        )(titleId => getStatus.run(titleId))(
          SeriesAnalysisStatusResponse.from
        )
      },
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.scopeStatus) { _ => input =>
        val decoded =
          for
            title <- SeriesAnalysisCodec.gameTitleId(input.gameTitleId)
            artifact <- input.artifactId.traverse(SeriesPlayerRadarCodec.opaqueId("artifactId", _))
            scope <- SeriesAnalysisCodec.scope(input.seasonMasterId, input.mapMasterId)
          yield SeriesAnalysisScopeStatusRequest(title, artifact, scope)
        execution.execute(
          decoded
        )(request => getStatus.scope(request))(
          SeriesAnalysisScopeStatusResponse.from
        )
      },
      scoped(
        SeriesAnalysisEndpoints.aggregateV5,
        SeriesAnalysisChunkKind.Aggregate,
      ),
      scoped(
        SeriesAnalysisEndpoints.reviewV3,
        SeriesAnalysisChunkKind.Review,
      ),
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.drilldown) { _ => input =>
        execution.execute(SeriesAnalysisCodec.chunk(
          kind = SeriesAnalysisChunkKind.Drilldown,
          rawGameTitleId = input.gameTitleId,
          rawArtifactId = input.artifactId,
          seasonMasterId = input.seasonMasterId,
          mapMasterId = input.mapMasterId,
          rawMemberId = Some(input.memberId),
          rawMetricId = Some(input.metricId),
          rawMatchId = None,
        ))(getChunk.run)(_.payload)
      },
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.matchContext) { _ => input =>
        execution.execute(SeriesAnalysisCodec.chunk(
          kind = SeriesAnalysisChunkKind.MatchContext,
          rawGameTitleId = input.gameTitleId,
          rawArtifactId = input.artifactId,
          seasonMasterId = input.seasonMasterId,
          mapMasterId = input.mapMasterId,
          rawMemberId = None,
          rawMetricId = None,
          rawMatchId = Some(input.matchId),
        ))(getChunk.run)(_.payload)
      },
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.outlookSummary) { _ => input =>
        execution.execute(SeriesAnalysisCodec.outlook(
          input.gameTitleId,
          input.artifactId,
          input.seasonMasterId,
          None,
          SeriesAnalysisChunkProjection.Stored,
          input.unsupportedScope
        ))(getChunk.run)(_.payload)
      },
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.outlookWindow) { _ => input =>
        execution.execute(SeriesAnalysisCodec.outlook(
          input.gameTitleId,
          input.artifactId,
          None,
          Some(input.memberId),
          SeriesAnalysisChunkProjection.OutlookWindow(input.windowSize),
          input.unsupportedScope
        ))(getChunk.run)(_.payload)
      },
      SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.outlookExamples) {
        _ => input =>
          execution.execute(SeriesAnalysisCodec.outlook(
            input.gameTitleId,
            input.artifactId,
            None,
            Some(input.memberId),
            SeriesAnalysisChunkProjection.OutlookExamples,
            input.unsupportedScope
          ))(getChunk.run)(_.payload)
      },
      SecuredEndpoint.operatorReadLogic(security, SeriesAnalysisEndpoints.adminOverview) {
        _ => rawTitleId =>
          execution.execute(
            SeriesAnalysisCodec.optionalGameTitleId(rawTitleId)
          )(titleId => getAdminOverview.run(titleId))(
            SeriesAnalysisAdminOverviewResponse.from
          )
      },
      SecuredEndpoint.operatorMutationLogic(security, SeriesAnalysisEndpoints.recalculateTitle) {
        account => input =>
          val (idempotencyKey, request) = input
          requiredIdempotencyKey(idempotencyKey, security) { key =>
            security.decode(SeriesAnalysisCodec.gameTitleId(request.gameTitleId)) { titleId =>
              execution.replay(
                HttpOperation.RequestSeriesAnalysisTitle,
                Some(key),
                account,
                request,
              )(
                security.respond(requestRecalculation.title(titleId, account.accountId, key))(
                  SeriesAnalysisRecalculationAcceptedResponse.from
                )
              )
            }
          }
      },
      SecuredEndpoint.adminMutationLogic(security, SeriesAnalysisEndpoints.recalculateAll) {
        account => input =>
          val (idempotencyKey, request) = input
          requiredIdempotencyKey(idempotencyKey, security) { key =>
            if request.confirmation != "all_titles" then
              security.toProblemF(AppError.ValidationFailed(
                "confirmation must be all_titles."
              )).map(Left(_))
            else
              execution.replay(
                HttpOperation.RequestSeriesAnalysisAll,
                Some(key),
                account,
                request,
              )(
                security.respond(requestRecalculation.all(account.accountId, key))(
                  SeriesAnalysisRecalculationAcceptedResponse.from
                )
              )
          }
      },
    )

  private def requiredIdempotencyKey[F[_]: Async, A](
      value: Option[String],
      security: EndpointSecurity[F],
  )(run: String => F[Either[ProblemDetails.ProblemResponse, A]])
      : F[Either[ProblemDetails.ProblemResponse, A]] = value match
    case Some(key) => run(key)
    case None => security.toProblemF(AppError.ValidationFailed(
        "Idempotency-Key is required."
      )).map(Left(_))
