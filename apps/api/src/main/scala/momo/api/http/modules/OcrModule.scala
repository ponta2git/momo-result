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
  CancelOcrJobResponse, CreateOcrJobRequest, CreateOcrJobResponse, OcrDraftEndpoints,
  OcrDraftListResponse, OcrDraftResponse, OcrJobEndpoints, OcrJobResponse, ProblemDetails,
}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{
  CancelOcrJob, CreateOcrJob, CreatedOcrJob, GetOcrDraft, GetOcrDraftsBulk, GetOcrJob,
}

object OcrModule:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.OcrModule")

  def routes[F[_]: Async](
      createOcrJob: CreateOcrJob[F],
      getOcrJob: GetOcrJob[F],
      cancelOcrJob: CancelOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
      createRateLimiter: RateLimiter[F],
      globalCreateRateLimiter: RateLimiter[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    OcrJobEndpoints.create.serverLogic {
      case (accountHeader, csrfToken, idemKey, requestId, request) => security
          .authorizeMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, CreateOcrJobRequest, CreateOcrJobResponse](
              idempotency,
              idemKey,
              member,
              "POST /api/ocr-jobs",
              request,
              nowF,
              security.decode(OcrJobCodec.toCreateCommand(request))(command =>
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
                          createOcrJob.run(command, requestId),
                          accountId = member.accountId.value,
                          request = request,
                          requestId = requestId,
                          security = security,
                        )
                    }
                }
              ),
            )
          }
    },
    OcrJobEndpoints.get.serverLogic { case (jobId, accountHeader) =>
      security.authorizeRead(accountHeader)(_ =>
        security.decode(
          BoundaryId.required("jobId", jobId)(OcrJobId.fromString)
        )(id => security.respond(getOcrJob.run(id))(OcrJobResponse.from))
      )
    },
    OcrJobEndpoints.cancel.serverLogic { case (jobId, accountHeader, csrfToken, idemKey) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, CancelOcrJobResponse](
          idempotency,
          idemKey,
          member,
          "DELETE /api/ocr-jobs",
          jobId,
          nowF,
          security.decode(BoundaryId.required("jobId", jobId)(OcrJobId.fromString))(id =>
            security.respond(cancelOcrJob.run(id))(_ => CancelOcrJobResponse(jobId, "cancelled"))
          ),
        )
      }
    },
    OcrDraftEndpoints.get.serverLogic { case (draftId, accountHeader) =>
      security.authorizeRead(accountHeader)(_ =>
        security.decode(BoundaryId.required("draftId", draftId)(OcrDraftId.fromString))(id =>
          security.respond(getOcrDraft.run(id).map(_.flatMap(OcrDraftResponse.from)))(identity)
        )
      )
    },
    OcrDraftEndpoints.listByIds.serverLogic { case (ids, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
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
      val matchDraftId = request.matchDraftId.getOrElse("none")
      val requestIdValue = requestId.getOrElse("none")
      val event = s"ocr_job_accepted accountId=$accountId jobId=${created.job.id.value} " +
        s"draftId=${created.draft.id.value} imageId=${request.imageId} " +
        s"requestedScreenType=${request.requestedScreenType} matchDraftId=$matchDraftId " +
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
