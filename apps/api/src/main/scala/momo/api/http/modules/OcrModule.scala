package momo.api.http.modules

import java.time.Instant

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
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
import momo.api.usecases.ocr.{
  CancelOcrJob,
  CreateOcrJob,
  CreatedOcrJob,
  GetOcrDraft,
  GetOcrDraftsBulk,
  GetOcrJob,
  OcrSubmissions
}

object OcrModule:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.OcrModule")

  def routes[F[_]: Async](
      createOcrJob: CreateOcrJob[F],
      submissions: OcrSubmissions[F],
      getOcrJob: GetOcrJob[F],
      cancelOcrJob: CancelOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
      createRateLimiter: RateLimiter[F],
      globalCreateRateLimiter: RateLimiter[F],
      readRateLimiter: RateLimiter[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.mutationLogic(security, OcrSubmissionEndpoints.put) { member =>
      { case (id, request) =>
        createRateLimiter.allow(s"ocr-submission-create:${member.accountId.value}").flatMap {
          case false => ocrCreateRateLimited(
              "account",
              member.accountId.value,
              "Too many reading operations. Try again later."
            )
          case true =>
            security.decode(momo.api.endpoints.codec.OcrSubmissionCodec.command(id, request))(
              command =>
                security.respond(submissions.put(
                  command,
                  member.accountId
                ))(OcrSubmissionResponse.from)
            )
        }
      }
    },
    SecuredEndpoint.readLogic(security, OcrSubmissionEndpoints.get) { member => id =>
      ReadRateLimit.enforce(
        readRateLimiter,
        member.accountId.value,
        HttpOperation.GetOcrSubmission
      ) {
        security.respond(submissions.get(id, member.accountId))(OcrSubmissionResponse.from)
      }
    },
    SecuredEndpoint.mutationLogic(security, OcrJobEndpoints.create) { member => input =>
      IdempotencyReplay.wrap[F, CreateOcrJobRequest, CreateOcrJobResponse](
        idempotency,
        input.idempotencyKey,
        member,
        HttpOperation.CreateOcrJob,
        input.request,
        nowF,
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
        ),
      )
    },
    SecuredEndpoint.readLogic(security, OcrJobEndpoints.get) { member => jobId =>
      ReadRateLimit.enforce(readRateLimiter, member.accountId.value, HttpOperation.GetOcrJob) {
        security.decode(
          BoundaryId.required("jobId", jobId)(OcrJobId.fromString)
        )(id => security.respond(getOcrJob.run(id))(OcrJobResponse.from))
      }
    },
    SecuredEndpoint.mutationLogic(security, OcrJobEndpoints.cancel) { member =>
      {
        case (jobId, idemKey) =>
          IdempotencyReplay.wrap[F, String, CancelOcrJobResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.CancelOcrJob,
            jobId,
            nowF,
            security.decode(BoundaryId.required("jobId", jobId)(OcrJobId.fromString))(id =>
              security.respond(cancelOcrJob.run(id))(_ => CancelOcrJobResponse(jobId, "cancelled"))
            ),
          )
      }
    },
    SecuredEndpoint.readLogic(security, OcrDraftEndpoints.get) { member => draftId =>
      ReadRateLimit.enforce(readRateLimiter, member.accountId.value, HttpOperation.GetOcrDraft) {
        security.decode(BoundaryId.required("draftId", draftId)(OcrDraftId.fromString))(id =>
          security.respond(getOcrDraft.run(id).map(_.flatMap(OcrDraftResponse.from)))(identity)
        )
      }
    },
    SecuredEndpoint.readLogic(security, OcrDraftEndpoints.listByIds) { member => ids =>
      ReadRateLimit.enforce(readRateLimiter, member.accountId.value, HttpOperation.ListOcrDrafts) {
        security.respond(
          OcrDraftCodec.toDraftIds(ids) match
            case Left(error) => Async[F].pure(Left(error))
            case Right(draftIds) => getOcrDraftsBulk.run(draftIds).map(_.flatMap(items =>
                items.traverse(OcrDraftResponse.from).map(OcrDraftListResponse(_))
              ))
        )(identity)
      }
    },
  )

  private def respondCreate[F[_]: Async](
      result: F[Either[AppError, CreatedOcrJob]],
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
      val event = s"ocr_job_accepted accountId=$accountId jobId=${created.job.id.value} " +
        s"draftId=${created.draft.id.value} imageId=${request.imageId} " +
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
