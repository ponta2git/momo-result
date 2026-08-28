package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.SeriesAnalysisChunkKind
import momo.api.endpoints.*
import momo.api.endpoints.codec.SeriesAnalysisCodec
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
import momo.api.usecases.seriesanalysis.*

object SeriesAnalysisModule:
  def routes[F[_]: Async](
      getOptions: GetSeriesAnalysisOptions[F],
      getStatus: GetSeriesAnalysisStatus[F],
      getChunk: GetSeriesAnalysisChunk[F],
      getAdminOverview: GetSeriesAnalysisAdminOverview[F],
      requestRecalculation: RequestSeriesAnalysisRecalculation[F],
      readRateLimiter: RateLimiter[F],
      idempotencyGuard: IdempotencyReplay.Guard[F],
      now: F[java.time.Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.options) { member => _ =>
      read(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesAnalysisOptions,
        security.respond(getOptions.run)(SeriesAnalysisOptionsResponse.from),
      )
    },
    SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.status) { member => rawTitleId =>
      read(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesAnalysisStatus,
        security.decode(SeriesAnalysisCodec.gameTitleId(rawTitleId))(titleId =>
          security.respond(getStatus.run(titleId))(SeriesAnalysisStatusResponse.from)
        )
      )
    },
    SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.aggregate) { member => input =>
      readChunk(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesAnalysisAggregate,
        getChunk,
        SeriesAnalysisCodec.chunk(
          kind = SeriesAnalysisChunkKind.Aggregate,
          rawGameTitleId = input.gameTitleId,
          rawArtifactId = input.artifactId,
          seasonMasterId = input.seasonMasterId,
          mapMasterId = input.mapMasterId,
          rawMemberId = None,
          rawMetricId = None,
          rawMatchId = None,
        ),
        security,
      )
    },
    SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.review) { member => input =>
      readChunk(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesAnalysisReview,
        getChunk,
        SeriesAnalysisCodec.chunk(
          kind = SeriesAnalysisChunkKind.Review,
          rawGameTitleId = input.gameTitleId,
          rawArtifactId = input.artifactId,
          seasonMasterId = input.seasonMasterId,
          mapMasterId = input.mapMasterId,
          rawMemberId = None,
          rawMetricId = None,
          rawMatchId = None,
        ),
        security,
      )
    },
    SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.drilldown) { member => input =>
      readChunk(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesAnalysisDrilldown,
        getChunk,
        SeriesAnalysisCodec.chunk(
          kind = SeriesAnalysisChunkKind.Drilldown,
          rawGameTitleId = input.gameTitleId,
          rawArtifactId = input.artifactId,
          seasonMasterId = input.seasonMasterId,
          mapMasterId = input.mapMasterId,
          rawMemberId = Some(input.memberId),
          rawMetricId = Some(input.metricId),
          rawMatchId = None,
        ),
        security,
      )
    },
    SecuredEndpoint.readLogic(security, SeriesAnalysisEndpoints.matchContext) { member => input =>
      readChunk(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetSeriesAnalysisMatchContext,
        getChunk,
        SeriesAnalysisCodec.chunk(
          kind = SeriesAnalysisChunkKind.MatchContext,
          rawGameTitleId = input.gameTitleId,
          rawArtifactId = input.artifactId,
          seasonMasterId = input.seasonMasterId,
          mapMasterId = input.mapMasterId,
          rawMemberId = None,
          rawMetricId = None,
          rawMatchId = Some(input.matchId),
        ),
        security,
      )
    },
    SecuredEndpoint.adminReadLogic(security, SeriesAnalysisEndpoints.adminOverview) {
      member => rawTitleId =>
        read(
          readRateLimiter,
          member.accountId.value,
          HttpOperation.GetSeriesAnalysisAdminOverview,
          security.decode(SeriesAnalysisCodec.optionalGameTitleId(rawTitleId))(titleId =>
            security.respond(
              getAdminOverview.run(titleId)
            )(SeriesAnalysisAdminOverviewResponse.from)
          )
        )
    },
    SecuredEndpoint.adminMutationLogic(security, SeriesAnalysisEndpoints.recalculateTitle) {
      account => input =>
        val (idempotencyKey, request) = input
        requiredIdempotencyKey(idempotencyKey, security) { key =>
          security.decode(SeriesAnalysisCodec.gameTitleId(request.gameTitleId)) { titleId =>
            IdempotencyReplay.wrap(
              idempotencyGuard,
              Some(key),
              account,
              HttpOperation.RequestSeriesAnalysisTitle,
              request,
              now,
              security.respond(requestRecalculation.title(titleId, account.accountId, key))(
                SeriesAnalysisRecalculationAcceptedResponse.from
              ),
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
            IdempotencyReplay.wrap(
              idempotencyGuard,
              Some(key),
              account,
              HttpOperation.RequestSeriesAnalysisAll,
              request,
              now,
              security.respond(requestRecalculation.all(account.accountId, key))(
                SeriesAnalysisRecalculationAcceptedResponse.from
              ),
            )
        }
    },
  )

  private def read[F[_]: Async, A](
      limiter: RateLimiter[F],
      accountId: String,
      operation: String,
      result: F[Either[ProblemDetails.ProblemResponse, A]],
  ): F[Either[ProblemDetails.ProblemResponse, A]] = ReadRateLimit
    .enforce(limiter, accountId, operation)(result)

  private def readChunk[F[_]: Async](
      limiter: RateLimiter[F],
      accountId: String,
      operation: String,
      getChunk: GetSeriesAnalysisChunk[F],
      decoded: Either[AppError, momo.api.domain.SeriesAnalysisChunkRequest],
      security: EndpointSecurity[F],
  ): F[Either[ProblemDetails.ProblemResponse, Array[Byte]]] = read(
    limiter,
    accountId,
    operation,
    security.decode(decoded)(request => security.respond(getChunk.run(request))(_.payload)),
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
