package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.ids.{OcrDraftId, OcrJobId}
import momo.api.endpoints.codec.{BoundaryId, OcrDraftCodec, OcrJobCodec}
import momo.api.endpoints.{
  CancelOcrJobResponse,
  CreateOcrJobRequest,
  CreateOcrJobResponse,
  OcrDraftEndpoints,
  OcrDraftListResponse,
  OcrDraftResponse,
  OcrJobEndpoints,
  OcrJobResponse,
  OcrSubmissionEndpoints,
  OcrSubmissionResponse,
  ProblemDetails
}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.repositories.OcrJobAcceptance
import momo.api.usecases.ocr.{
  CancelOcrJob,
  CreateOcrJob,
  GetOcrDraft,
  GetOcrDraftsBulk,
  GetOcrJob,
  OcrSubmissions
}

object OcrModule:
  final case class UseCases[F[_]](
      createOcrJob: CreateOcrJob[F],
      submissions: OcrSubmissions[F],
      getOcrJob: GetOcrJob[F],
      cancelOcrJob: CancelOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
  )

  private val logger = LoggerFactory.getLogger("momo.api.http.modules.OcrModule")

  def routes[F[_]: Async](
      useCases: UseCases[F],
      createRateLimiter: RateLimiter[F],
      globalCreateRateLimiter: RateLimiter[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.mutationLogic(security, OcrSubmissionEndpoints.put) { member =>
        { case (id, request) =>
          security.decode(momo.api.endpoints.codec.OcrSubmissionCodec.command(id, request)) {
            command =>
              val admitNew: F[Either[AppError, Unit]] =
                createRateLimiter.allow(s"ocr-submission-create:${member.accountId.value}")
                  .map(allowed =>
                    Either.cond(
                      allowed,
                      (),
                      AppError.TooManyRequests(
                        "Too many reading operations. Try again later."
                      )
                    )
                  )
              security.respond(submissions.put(command, member.accountId, admitNew))(
                OcrSubmissionResponse.from
              )
          }
        }
      },
      SecuredEndpoint.readLogic(security, OcrSubmissionEndpoints.get) { member => id =>
        security.respond(submissions.get(id, member.accountId))(OcrSubmissionResponse.from)
      },
      SecuredEndpoint.mutationLogic(security, OcrJobEndpoints.create) { member => input =>
        execution.replay(
          HttpOperation.CreateOcrJob,
          input.idempotencyKey,
          member,
          input.request,
        )(
          security.decode(OcrJobCodec.toCreateCommand(input.request))(command =>
            createRateLimiter.allow(s"ocr-job-create:${member.accountId.value}").flatMap {
              case false => ocrCreateRateLimited(
                  scope = "account",
                  accountId = member.accountId.value,
                  detail = "Too many OCR jobs. Try again later.",
                )
              case true => globalCreateRateLimiter.allow("global").flatMap {
                  case false => ocrCreateRateLimited(
                      scope = "global",
                      accountId = member.accountId.value,
                      detail = "Too many OCR jobs are being created. Try again later.",
                    )
                  case true => respondCreate(
                      createOcrJob.run(command, input.requestId, member.accountId),
                      accountId = member.accountId.value,
                      request = input.request,
                      requestId = input.requestId,
                      security = security,
                    )
                }
            }
          )
        )
      },
      SecuredEndpoint.readLogic(security, OcrJobEndpoints.get) { _ => jobId =>
        execution.execute(
          BoundaryId.required("jobId", jobId)(OcrJobId.fromString)
        )(id => getOcrJob.run(id))(
          OcrJobResponse.from
        )
      },
      SecuredEndpoint.mutationLogic(security, OcrJobEndpoints.cancel) { member =>
        {
          case (jobId, idemKey) =>
            execution.mutation(
              HttpOperation.CancelOcrJob,
              idemKey,
              member,
              jobId,
            )(
              BoundaryId.required("jobId", jobId)(OcrJobId.fromString)
            )(id =>
              cancelOcrJob.run(id, member.accountId)
            )(_ =>
              CancelOcrJobResponse(jobId, "cancelled")
            )
        }
      },
      SecuredEndpoint.readLogic(security, OcrDraftEndpoints.get) { _ => draftId =>
        execution.execute(
          BoundaryId.required("draftId", draftId)(OcrDraftId.fromString)
        )(id => getOcrDraft.run(id).map(_.flatMap(OcrDraftResponse.from)))(
          identity
        )
      },
      SecuredEndpoint.readLogic(security, OcrDraftEndpoints.listByIds) { _ => ids =>
        security.respond(
          OcrDraftCodec.toDraftIds(ids) match
            case Left(error) => Async[F].pure(Left(error))
            case Right(draftIds) => getOcrDraftsBulk.run(draftIds).map(_.flatMap(items =>
                items.traverse(OcrDraftResponse.from).map(OcrDraftListResponse(_))
              ))
        )(identity)
      },
    )

  private def respondCreate[F[_]: Async](
      result: F[Either[AppError, OcrJobAcceptance]],
      accountId: String,
      request: CreateOcrJobRequest,
      requestId: Option[String],
      security: EndpointSecurity[F],
  ): F[Either[ProblemDetails.ProblemResponse, CreateOcrJobResponse]] = result.flatMap {
    case Left(error) => security.toProblemF(error).map(Left(_))
    case Right(created) =>
      val response = OcrJobCodec.toCreateResponse(created)
      val submissionId = request.submissionId
      val requestIdValue = requestId.getOrElse("none")
      val event = s"ocr_job_accepted accountId=$accountId jobId=${created.id.value} " +
        s"draftId=${created.draftId.value} imageId=${request.imageId} " +
        s"requestedScreenType=${request.requestedScreenType} submissionId=$submissionId " +
        s"requestId=$requestIdValue"
      Async[F].delay(logger.info(event)) *> Async[F].pure(Right(response))
  }

  private def ocrCreateRateLimited[F[_]: Async, A](
      scope: String,
      accountId: String,
      detail: String,
  ): F[Either[ProblemDetails.ProblemResponse, A]] = Async[F]
    .delay(logger.warn(s"ocr_job_create_rate_limited scope=$scope accountId=$accountId")) *>
    Async[F].pure(Left(ProblemDetails.from(AppError.TooManyRequests(detail))))
