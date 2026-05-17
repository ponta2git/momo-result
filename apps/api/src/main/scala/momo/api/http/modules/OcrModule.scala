package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{OcrDraftId, OcrJobId}
import momo.api.endpoints.codec.{BoundaryId, OcrDraftCodec, OcrJobCodec}
import momo.api.endpoints.{
  CancelOcrJobResponse, CreateOcrJobRequest, OcrDraftEndpoints, OcrDraftListResponse,
  OcrDraftResponse, OcrJobEndpoints, OcrJobResponse,
}
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{CancelOcrJob, CreateOcrJob, GetOcrDraft, GetOcrDraftsBulk, GetOcrJob}

object OcrModule:
  def routes[F[_]: Async](
      createOcrJob: CreateOcrJob[F],
      getOcrJob: GetOcrJob[F],
      cancelOcrJob: CancelOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    OcrJobEndpoints.create.serverLogic {
      case (accountHeader, csrfToken, idemKey, requestId, request) => security
          .authorizeMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, CreateOcrJobRequest, momo.api.endpoints.CreateOcrJobResponse](
              idempotency,
              idemKey,
              member,
              "POST /api/ocr-jobs",
              request,
              nowF,
              security.decode(OcrJobCodec.toCreateCommand(request))(command =>
                security.respond(createOcrJob.run(command, requestId))(OcrJobCodec.toCreateResponse)
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
