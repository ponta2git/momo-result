package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{OcrDraftId, OcrJobId}
import momo.api.endpoints.codec.OcrJobCodec
import momo.api.endpoints.{
  CancelOcrJobResponse, CreateOcrJobRequest, OcrDraftEndpoints, OcrDraftListResponse,
  OcrDraftResponse, OcrJobEndpoints, OcrJobResponse,
}
import momo.api.http.{EndpointSecurity, IdempotencyHandler}
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
    OcrJobEndpoints.create.serverLogic { case (devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, CreateOcrJobRequest, momo.api.endpoints.CreateOcrJobResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/ocr-jobs",
          request,
          nowF,
          security.respond(createOcrJob.run(OcrJobCodec.toCreateCommand(request)))(
            OcrJobCodec.toCreateResponse
          ),
        )
      }
    },
    OcrJobEndpoints.get.serverLogic { case (jobId, devUser) =>
      security.authorizeRead(devUser)(_ =>
        security.respond(getOcrJob.run(OcrJobId(jobId)))(OcrJobResponse.from)
      )
    },
    OcrJobEndpoints.cancel.serverLogic { case (jobId, devUser, csrfToken) =>
      security.authorizeMutation(devUser, csrfToken) { _ =>
        security.respond(cancelOcrJob.run(OcrJobId(jobId)))(_ =>
          CancelOcrJobResponse(jobId, "cancelled")
        )
      }
    },
    OcrDraftEndpoints.get.serverLogic { case (draftId, devUser) =>
      security.authorizeRead(devUser)(_ =>
        security.respond(getOcrDraft.run(OcrDraftId(draftId)))(OcrDraftResponse.from)
      )
    },
    OcrDraftEndpoints.listByIds.serverLogic { case (ids, devUser) =>
      security.authorizeRead(devUser) { _ =>
        security.respond(getOcrDraftsBulk.run(ids))(items =>
          OcrDraftListResponse(items.map(OcrDraftResponse.from))
        )
      }
    },
  )
